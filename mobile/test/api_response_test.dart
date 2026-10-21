import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zinda_play/api.dart';

void main() {
  test(
    'ordinary builds use the deployed backend unless explicitly overridden',
    () {
      const override = String.fromEnvironment('API_URL');
      expect(
        apiOrigin,
        override.isEmpty ? 'https://api.zindaplay.com' : override,
      );
      expect(apiBase, '$apiOrigin/api');
      expect(
        assetUrl('/videos/thumbnail/example'),
        '$apiBase/videos/thumbnail/example',
      );
    },
  );

  test('successful JSON and empty responses retain their existing shapes', () {
    expect(
      decodeApiResponse(http.Response('{"items":[],"nextCursor":null}', 200)),
      {'items': [], 'nextCursor': null},
    );
    expect(decodeApiResponse(http.Response('[]', 200)), []);
    expect(decodeApiResponse(http.Response('', 204)), isNull);
  });

  test('JSON API errors preserve the server message', () {
    expect(
      () =>
          decodeApiResponse(http.Response('{"error":"Sign in required"}', 401)),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          'Sign in required',
        ),
      ),
    );
  });

  test('missing deployed route explains that the backend needs updating', () {
    expect(
      () => decodeApiResponse(
        http.Response('<!DOCTYPE html><pre>Cannot GET /api/shorts</pre>', 404),
      ),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          contains('Deploy the latest Zinda Play backend'),
        ),
      ),
    );
  });

  test(
    'proxy HTML errors and invalid success responses are explicit API errors',
    () {
      expect(
        () => decodeApiResponse(http.Response('<html>Bad gateway</html>', 502)),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            contains('(502)'),
          ),
        ),
      );
      expect(
        () => decodeApiResponse(
          http.Response('<html>Website instead of API</html>', 200),
        ),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            contains('invalid response'),
          ),
        ),
      );
      expect(
        () => decodeApiResponse(http.Response('', 503)),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            contains('(503)'),
          ),
        ),
      );
    },
  );
}
