import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

// Override API_URL for local development or a different deployment.
const apiOrigin = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://api.zindaplay.com',
);
const apiBase = '$apiOrigin/api';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

dynamic decodeApiResponse(http.Response response) {
  dynamic body;
  if (response.body.isNotEmpty) {
    try {
      body = jsonDecode(response.body);
    } on FormatException {
      if (response.statusCode == 404) {
        throw ApiException(
          'This feature is not available on the server yet. Deploy the latest Zinda Play backend, then retry.',
        );
      }
      if (response.statusCode >= 400) {
        throw ApiException(
          'The server returned an error (${response.statusCode}). Please try again later.',
        );
      }
      throw ApiException(
        'The server returned an invalid response. Check the API address and server deployment.',
      );
    }
  }
  if (response.statusCode >= 400) {
    throw ApiException(
      body is Map && body['error'] != null
          ? '${body['error']}'
          : 'Request failed (${response.statusCode}).',
    );
  }
  return body;
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
  bool promoterAccount = false;

  bool get signedIn => token != null;

  Future<void> updateUsername(String value) async {
    username = value;
    await _storage.write(key: 'username', value: value);
  }

  Future<void> restore() async {
    token = await _storage.read(key: 'token');
    username = await _storage.read(key: 'username');
    role = await _storage.read(key: 'role');
    promoterAccount =
        await _storage.read(key: 'promoterAccount') == 'true' ||
        role == 'promoter';
  }

  Future<void> _save(Map<String, dynamic> data) async {
    token = data['token'] as String?;
    username = data['username'] as String?;
    role = data['role'] as String?;
    promoterAccount = data['promoterAccount'] == true;
    await _storage.write(key: 'token', value: token);
    await _storage.write(key: 'username', value: username);
    await _storage.write(key: 'role', value: role);
    await _storage.write(key: 'promoterAccount', value: '$promoterAccount');
  }

  Future<Map<String, dynamic>> switchMode(String mode) async {
    final data = Map<String, dynamic>.from(
      await post('/account/mode', {'mode': mode}) as Map,
    );
    role = data['role'] as String;
    promoterAccount = data['promoterAccount'] == true;
    await _storage.write(key: 'role', value: role);
    await _storage.write(key: 'promoterAccount', value: '$promoterAccount');
    return data;
  }

  Future<void> refreshAccountRole() async {
    if (!signedIn || role == 'business' || role == 'admin') return;
    final data = Map<String, dynamic>.from(await get('/account') as Map);
    role = data['role'] as String;
    promoterAccount = data['promoterAccount'] == true;
    await _storage.write(key: 'role', value: role);
    await _storage.write(key: 'promoterAccount', value: '$promoterAccount');
  }

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (token != null) 'Authorization': 'Bearer $token',
  };

  Future<dynamic> _send(
    Future<http.Response> Function() call, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final http.Response res;
    try {
      res = await call().timeout(timeout);
    } catch (_) {
      throw ApiException('Could not connect to the server.');
    }
    return decodeApiResponse(res);
  }

  Future<dynamic> get(String path) =>
      _send(() => http.get(Uri.parse('$apiBase$path'), headers: _headers));
  Future<dynamic> post(String path, [Object? body]) => _send(
    () => http.post(
      Uri.parse('$apiBase$path'),
      headers: _headers,
      body: jsonEncode(body ?? {}),
    ),
  );
  Future<dynamic> delete(String path) =>
      _send(() => http.delete(Uri.parse('$apiBase$path'), headers: _headers));
  Future<dynamic> patch(String path, Object body) => _send(
    () => http.patch(
      Uri.parse('$apiBase$path'),
      headers: _headers,
      body: jsonEncode(body),
    ),
  );
  Future<dynamic> put(String path, Object body) => _send(
    () => http.put(
      Uri.parse('$apiBase$path'),
      headers: _headers,
      body: jsonEncode(body),
    ),
  );

  // Streams a file as the raw request body, as the web app does.
  Future<dynamic> uploadFile(
    String method,
    String path,
    File file,
    String contentType, {
    Map<String, String> headers = const {},
    void Function(double)? onProgress,
  }) async {
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
    file.openRead().listen(
      (chunk) {
        sent += chunk.length;
        onProgress?.call(sent / size);
        request.sink.add(chunk);
      },
      onDone: request.sink.close,
      onError: request.sink.addError,
      cancelOnError: true,
    );
    final http.Response res;
    try {
      res = await http.Response.fromStream(await request.send());
    } catch (_) {
      throw ApiException('Upload failed. Check your connection and try again.');
    }
    return decodeApiResponse(res);
  }

  Future<void> login(String username, String password) async {
    final data = await post('/auth/login', {
      'username': username,
      'password': password,
    });
    await _save(Map<String, dynamic>.from(data));
  }

  Future<void> register(
    String username,
    String password, {
    String? referrer,
    String accountType = 'member',
    String? businessName,
  }) async {
    if (accountType == 'creator' || accountType == 'promoter') {
      accountType = 'member';
    }
    final data = await post('/auth/register', {
      'username': username,
      'password': password,
      if (accountType != 'member') 'accountType': accountType,
      if (accountType == 'business') 'businessName': businessName ?? '',
      if (accountType == 'member' && referrer != null && referrer.isNotEmpty)
        'referrerPromoterId': referrer,
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
    promoterAccount = false;
    await _storage.deleteAll();
  }

  Future<void> deleteAccount(String password, String confirmation) async {
    await _send(
      () => http.delete(
        Uri.parse('$apiBase/account'),
        headers: _headers,
        body: jsonEncode({'password': password, 'confirmation': confirmation}),
      ),
      timeout: const Duration(minutes: 5),
    );
    token = null;
    username = null;
    role = null;
    promoterAccount = false;
    await _storage.deleteAll();
  }
}
