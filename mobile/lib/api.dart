import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

// Android emulator reaches the host PC at 10.0.2.2. For production build with:
// flutter build apk --dart-define=API_URL=https://your-api-domain
const apiOrigin = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:4000');
const apiBase = '$apiOrigin/api';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

String assetUrl(String? path) {
  if (path == null || path.isEmpty) return '';
  if (RegExp(r'^https?://', caseSensitive: false).hasMatch(path)) return path;
  return '$apiBase${path.startsWith('/') ? path : '/$path'}';
}

class Api {
  Api._();
  static final Api instance = Api._();
  static const _storage = FlutterSecureStorage();

  String? token;
  String? username;
  String? role;

  bool get signedIn => token != null;

  Future<void> restore() async {
    token = await _storage.read(key: 'token');
    username = await _storage.read(key: 'username');
    role = await _storage.read(key: 'role');
  }

  Future<void> _save(Map<String, dynamic> data) async {
    token = data['token'] as String?;
    username = data['username'] as String?;
    role = data['role'] as String?;
    await _storage.write(key: 'token', value: token);
    await _storage.write(key: 'username', value: username);
    await _storage.write(key: 'role', value: role);
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> _send(Future<http.Response> Function() call) async {
    final http.Response res;
    try {
      res = await call().timeout(const Duration(seconds: 20));
    } catch (_) {
      throw ApiException('Could not connect to the server.');
    }
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw ApiException(body is Map && body['error'] != null ? '${body['error']}' : 'Request failed (${res.statusCode}).');
    }
    return body;
  }

  Future<dynamic> get(String path) => _send(() => http.get(Uri.parse('$apiBase$path'), headers: _headers));
  Future<dynamic> post(String path, [Object? body]) =>
      _send(() => http.post(Uri.parse('$apiBase$path'), headers: _headers, body: jsonEncode(body ?? {})));
  Future<dynamic> delete(String path) => _send(() => http.delete(Uri.parse('$apiBase$path'), headers: _headers));
  Future<dynamic> patch(String path, Object body) =>
      _send(() => http.patch(Uri.parse('$apiBase$path'), headers: _headers, body: jsonEncode(body)));
  Future<dynamic> put(String path, Object body) =>
      _send(() => http.put(Uri.parse('$apiBase$path'), headers: _headers, body: jsonEncode(body)));

  // Streams a file as the raw request body, as the web app does.
  Future<dynamic> uploadFile(String method, String path, File file, String contentType,
      {Map<String, String> headers = const {}, void Function(double)? onProgress}) async {
    final size = await file.length();
    final request = http.StreamedRequest(method, Uri.parse('$apiBase$path'))
      ..contentLength = size
      ..headers.addAll({
        if (token != null) 'Authorization': 'Bearer $token',
        'Content-Type': contentType,
        'X-Upload-Size': '$size',
        ...headers,
      });
    var sent = 0;
    file.openRead().listen((chunk) {
      sent += chunk.length;
      onProgress?.call(sent / size);
      request.sink.add(chunk);
    }, onDone: request.sink.close, onError: request.sink.addError, cancelOnError: true);
    final http.Response res;
    try {
      res = await http.Response.fromStream(await request.send());
    } catch (_) {
      throw ApiException('Upload failed. Check your connection and try again.');
    }
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw ApiException(body is Map && body['error'] != null ? '${body['error']}' : 'Upload failed (${res.statusCode}).');
    }
    return body;
  }

  Future<void> login(String username, String password) async {
    final data = await post('/auth/login', {'username': username, 'password': password});
    await _save(Map<String, dynamic>.from(data));
  }

  Future<void> register(String username, String password, {String? referrer, String accountType = 'member', String? businessName}) async {
    final data = await post('/auth/register', {
      'username': username,
      'password': password,
      if (accountType != 'member') 'accountType': accountType,
      if (accountType == 'business') 'businessName': businessName ?? '',
      if (accountType == 'member' && referrer != null && referrer.isNotEmpty) 'referrerPromoterId': referrer,
    });
    if (data is Map && data['token'] != null) {
      await _save(Map<String, dynamic>.from(data));
    } else {
      await login(username, password);
    }
  }

  Future<void> logout() async {
    try {
      await post('/auth/logout');
    } catch (_) {}
    token = null;
    username = null;
    role = null;
    await _storage.deleteAll();
  }
}
