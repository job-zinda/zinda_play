import { ObjectId } from "mongodb";

const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const clone = value => {
  if (value instanceof ObjectId) return new ObjectId(value);
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};
const equal = (a, b) => a instanceof ObjectId || b instanceof ObjectId ? a?.toString() === b?.toString() : a === b;
function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(item => matches(document, item));
    if (key === "$and") return value.every(item => matches(document, item));
    if (key === "$expr") {
      const evaluate = expression => {
        if (typeof expression === "string" && expression.startsWith("$")) return get(document, expression.slice(1));
        if (!expression || typeof expression !== "object") return expression;
        if (expression.$ifNull) return evaluate(expression.$ifNull[0]) ?? evaluate(expression.$ifNull[1]);
        if (expression.$or) return expression.$or.some(evaluate);
        if (expression.$lte) return evaluate(expression.$lte[0]) <= evaluate(expression.$lte[1]);
        if (expression.$lt) return evaluate(expression.$lt[0]) < evaluate(expression.$lt[1]);
        throw new Error("Unsupported test expression");
      };
      return evaluate(value);
    }
    const actual = get(document, key);
    if (value instanceof ObjectId) return equal(actual, value);
    if (value && typeof value === "object") {
      if ("$in" in value) return value.$in.some(item => equal(actual, item));
      if ("$nin" in value) return !value.$nin.some(item => equal(actual, item));
      if ("$lt" in value) return String(actual) < String(value.$lt);
      if ("$gt" in value) return actual !== undefined && actual !== null && (typeof value.$gt === "number" ? typeof actual === "number" && actual > value.$gt : String(actual) > String(value.$gt));
      if ("$exists" in value) return (actual !== undefined) === value.$exists;
      if ("$ne" in value) return !equal(actual, value.$ne);
      throw new Error(`Unsupported test query: ${JSON.stringify(value)}`);
    }
    return equal(actual, value);
  });
}
function setFields(document, fields) {
  for (const [path, value] of Object.entries(fields || {})) {
    const keys = path.split(".");
    let target = document;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = value;
  }
}
function applyUpdate(document, update) {
  setFields(document, update.$set);
  for (const key of Object.keys(update.$unset || {})) {
    const keys = key.split(".");
    const parent = keys.slice(0, -1).reduce((value, part) => value?.[part], document);
    if (parent) delete parent[keys.at(-1)];
  }
  for (const [key, value] of Object.entries(update.$inc || {})) setFields(document, { [key]: (get(document, key) || 0) + value });
  for (const [key, value] of Object.entries(update.$max || {})) setFields(document, { [key]: Math.max(get(document, key) || 0, value) });
  for (const [key, value] of Object.entries(update.$push || {})) {
    const list = get(document, key) || [];
    list.push(value);
    setFields(document, { [key]: list });
  }
}
export function memoryDatabase() {
  const collections = new Map();
  return {
    collection(name) {
      if (collections.has(name)) return collections.get(name);
      const collection = {
        documents: [],
        async createIndex() {},
        listIndexes() { return { toArray: async () => [] }; },
        async findOne(filter) { return clone(this.documents.find(document => matches(document, filter)) || null); },
        async countDocuments(filter) { return this.documents.filter(document => matches(document, filter)).length; },
        aggregate(stages) {
          let rows = this.documents.map(clone);
          for (const stage of stages) {
            if (stage.$match) rows = rows.filter(row => matches(row, stage.$match));
            else if (stage.$group) {
              const groups = new Map();
              for (const row of rows) {
                const id = get(row, stage.$group._id.slice(1));
                const group = groups.get(id) || { _id: id };
                for (const [key, expression] of Object.entries(stage.$group)) {
                  if (key === "_id") continue;
                  const amount = expression.$sum;
                  group[key] = (group[key] || 0) + (typeof amount === "number" ? amount : get(row, amount.slice(1)) || 0);
                }
                groups.set(id, group);
              }
              rows = [...groups.values()];
            } else throw new Error("Unsupported test aggregation stage");
          }
          return { toArray: async () => rows };
        },
        find(filter = {}) {
          let result = this.documents.filter(document => matches(document, filter)).map(clone);
          const cursor = {
            sort(spec) {
              result.sort((a, b) => {
                for (const [key, direction] of Object.entries(spec)) {
                  const difference = String(get(a, key)).localeCompare(String(get(b, key))) * direction;
                  if (difference) return difference;
                }
                return 0;
              });
              return cursor;
            },
            limit(count) { result = result.slice(0, count); return cursor; },
            async toArray() { return result; }
          };
          return cursor;
        },
        async insertOne(document) {
          if (name === "membershipPayments" && this.documents.some(item =>
            item.creatorId === document.creatorId && ["pending", "approving"].includes(item.status))) {
            throw Object.assign(new Error("Duplicate pending payment"), { code: 11000 });
          }
          if (document._id && this.documents.some(item => equal(item._id, document._id))) {
            throw Object.assign(new Error("Duplicate ID"), { code: 11000 });
          }
          if (name === "shortViews" && this.documents.some(item => item.videoId === document.videoId && item.viewerHash === document.viewerHash)) {
            throw Object.assign(new Error("Duplicate short view"), { code: 11000 });
          }
          document._id ??= new ObjectId();
          this.documents.push(document);
          return { insertedId: document._id };
        },
        async updateOne(filter, update, options = {}) {
          let document = this.documents.find(item => matches(item, filter));
          if (!document && options.upsert) {
            document = { ...filter };
            await this.insertOne(document);
            setFields(document, update.$setOnInsert);
          }
          if (!document) return { matchedCount: 0 };
          applyUpdate(document, update);
          return { matchedCount: 1 };
        },
        async findOneAndUpdate(filter, update, options = {}) {
          let document = this.documents.find(item => matches(item, filter));
          if (!document && options.upsert) {
            document = { ...filter };
            await this.insertOne(document);
            setFields(document, update.$setOnInsert);
          }
          if (!document) return null;
          applyUpdate(document, update);
          return clone(document);
        },
        async deleteOne(filter) {
          const previous = this.documents.length;
          this.documents = this.documents.filter(document => !matches(document, filter));
          return { deletedCount: previous - this.documents.length };
        },
        async deleteMany(filter) {
          this.documents = this.documents.filter(document => !matches(document, filter));
        }
      };
      collections.set(name, collection);
      return collection;
    }
  };
}
