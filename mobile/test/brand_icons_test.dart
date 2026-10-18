import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;

void main() {
  test('adaptive icon artwork stays inside the Android circular safe zone', () {
    final icon = image.decodePng(
      File('assets${Platform.pathSeparator}icon_adaptive.png')
          .readAsBytesSync(),
    )!;
    expect(icon.width, 1024);
    expect(icon.height, 1024);
    double furthest = 0;
    int visible = 0;
    for (final pixel in icon) {
      if (pixel.a < 200) continue;
      visible++;
      final x = pixel.x - (icon.width - 1) / 2;
      final y = pixel.y - (icon.height - 1) / 2;
      furthest = max(furthest, sqrt(x * x + y * y));
    }
    expect(visible, greaterThan(100000));
    expect(furthest, lessThan(icon.width / 3));
    final xml = File(
      'android${Platform.pathSeparator}app${Platform.pathSeparator}src${Platform.pathSeparator}main${Platform.pathSeparator}res${Platform.pathSeparator}mipmap-anydpi-v26${Platform.pathSeparator}ic_launcher.xml',
    ).readAsStringSync();
    expect(xml, contains('android:inset="0%"'));
  });

  test('legacy and website icons have opaque padded edges', () {
    for (final path in [
      'assets${Platform.pathSeparator}icon_launcher.png',
      '..${Platform.pathSeparator}client${Platform.pathSeparator}public${Platform.pathSeparator}app-icon.png',
    ]) {
      final icon = image.decodePng(File(path).readAsBytesSync())!;
      expect(icon.width, icon.height);
      int transparent = 0;
      int unpadded = 0;
      for (final pixel in icon) {
        if (pixel.a != 255) transparent++;
        if (pixel.x < icon.width * 0.09 ||
            pixel.y < icon.height * 0.09 ||
            pixel.x > icon.width * 0.91 ||
            pixel.y > icon.height * 0.91) {
          if (pixel.r != 11 || pixel.g != 13 || pixel.b != 18) unpadded++;
        }
      }
      expect(transparent, 0);
      expect(unpadded, 0);
    }
  });
}
