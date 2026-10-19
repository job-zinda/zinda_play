import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zinda_play/public_links.dart';

void main() {
  test('video shares and invitation links use the custom domain', () {
    expect(
      videoShareUrl('regular-id'),
      'https://zindaplay.com/share/video/regular-id?preview=video-frame-v2',
    );
    expect(
      videoShareUrl('short-id'),
      'https://zindaplay.com/share/video/short-id?preview=video-frame-v2',
    );
    expect(
      videoShareUrl('id/?'),
      'https://zindaplay.com/share/video/id%2F%3F?preview=video-frame-v2',
    );
    expect(referralUrl('123456'), 'https://zindaplay.com/?ref=123456');
    expect(
      creatorShareUrl('creator id'),
      'https://zindaplay.com/share/creator/creator%20id',
    );
    expect(Uri.parse(referralUrl('code&video=other')).queryParameters, {
      'ref': 'code&video=other',
    });
  });

  test('Ask me opens the requested WhatsApp number and message', () {
    final url = Uri.parse(whatsAppHelpUrl);
    expect(url.origin, 'https://wa.me');
    expect(url.path, '/919847561998');
    expect(url.queryParameters, {'text': 'Zindaplay'});
  });

  testWidgets('copy invitation copies the whole link and confirms success', (
    tester,
  ) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return TextButton(
                onPressed: () =>
                    copyPublicLink(context, referralUrl('my-code')),
                child: const Text('Copy invitation link'),
              );
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Copy invitation link'));
    await tester.pumpAndSettle();
    expect(copied, 'https://zindaplay.com/?ref=my-code');
    expect(find.text('Link copied.'), findsOneWidget);
  });

  testWidgets('native share sends invitation text, link and a popover origin', (
    tester,
  ) async {
    Map<dynamic, dynamic>? payload;
    const channel = MethodChannel('dev.fluttercommunity.plus/share');
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
      call,
    ) async {
      expect(call.method, 'share');
      payload = call.arguments as Map;
      return 'chosen-app';
    });
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return TextButton(
                onPressed: () => sharePublicLink(
                  context,
                  'Join me on Zinda Play',
                  referralUrl('my-code'),
                ),
                child: const Text('Share invitation'),
              );
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Share invitation'));
    await tester.pumpAndSettle();
    expect(
      payload?['text'],
      'Join me on Zinda Play\nhttps://zindaplay.com/?ref=my-code',
    );
    expect(payload?['originWidth'], greaterThan(0));
    expect(payload?['originHeight'], greaterThan(0));
  });

  testWidgets('clipboard failures are visible and never report success', (
    tester,
  ) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          throw PlatformException(code: 'denied', message: 'Clipboard blocked');
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return TextButton(
                onPressed: () =>
                    copyPublicLink(context, referralUrl('my-code')),
                child: const Text('Copy invitation link'),
              );
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Copy invitation link'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Clipboard blocked'), findsOneWidget);
    expect(find.text('Link copied.'), findsNothing);
  });
}
