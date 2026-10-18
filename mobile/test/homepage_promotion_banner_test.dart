import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zinda_play/widgets/homepage_promotion_banner.dart';

void main() {
  for (final width in [320.0, 360.0, 390.0, 1200.0]) {
    testWidgets(
      'promotion keeps a 3:1 image without overflow at width $width',
      (tester) async {
        tester.view.physicalSize = Size(width, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: HomepagePromotionBanner(
                  banner: {
                    'enabled': true,
                    'imageUrl': 'https://example.test/banner.png',
                    'title': 'Discover stories and skills from your favourite creators',
                    'description': 'A responsive promotion with its text below the artwork.',
                    'buttonLabel': 'Explore the library',
                    'buttonUrl': 'https://example.test/explore',
                  },
                ),
              ),
            ),
          ),
        );
        final area = tester.getSize(find.byType(AspectRatio));
        expect(area.width / area.height, closeTo(3, 0.001));
        expect(area.width, lessThanOrEqualTo(width));
        expect(tester.widget<Image>(find.byType(Image)).fit, BoxFit.contain);
        expect(tester.getSize(find.byType(Card)), area);
        expect(find.text('FEATURED'), findsNothing);
        expect(find.text('Explore the library'), findsNothing);
        expect(find.byType(FilledButton), findsNothing);
        expect(tester.widget<InkWell>(find.byType(InkWell)).onTap, isNotNull);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('disabled promotion remains hidden', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: HomepagePromotionBanner(
          banner: {'enabled': false, 'title': 'Hidden offer'},
        ),
      ),
    );
    expect(find.text('Hidden offer'), findsNothing);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('promotion without an image takes no space', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: HomepagePromotionBanner(
            banner: {
              'enabled': true,
              'title': 'Text-only offer',
              'buttonLabel': 'Unsafe link',
              'buttonUrl': 'javascript:alert(1)',
            },
          ),
        ),
      ),
    );
    expect(find.text('Text-only offer'), findsNothing);
    expect(find.byType(Image), findsNothing);
    expect(find.byType(Card), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('invalid banner destination is not tappable', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: HomepagePromotionBanner(
            banner: {
              'enabled': true,
              'imageUrl': 'https://example.test/banner.png',
              'buttonUrl': 'javascript:alert(1)',
            },
          ),
        ),
      ),
    );
    expect(tester.widget<InkWell>(find.byType(InkWell)).onTap, isNull);
    expect(tester.takeException(), isNull);
  });
}
