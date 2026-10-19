import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zinda_play/public_links.dart';
import 'package:zinda_play/widgets/whatsapp_help_button.dart';

void main() {
  for (final successful in [true, false]) {
    testWidgets(
      'Ask me launches externally and reports failure: ${!successful}',
      (tester) async {
        const channel = MethodChannel('plugins.flutter.io/url_launcher');
        Map<dynamic, dynamic>? arguments;
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (call) async {
            expect(call.method, 'launch');
            arguments = call.arguments as Map;
            return successful;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(floatingActionButton: WhatsAppHelpButton()),
          ),
        );
        await tester.tap(find.text('Ask me'));
        await tester.pumpAndSettle();
        expect(arguments?['url'], whatsAppHelpUrl);
        expect(arguments?['useWebView'], false);
        expect(arguments?['useSafariVC'], false);
        expect(
          find.text('Could not open WhatsApp. Please try again.'),
          successful ? findsNothing : findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
