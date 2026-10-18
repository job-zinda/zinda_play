import 'dart:io';

import 'package:image/image.dart' as image;

void main() {
  final root = File.fromUri(Platform.script).parent.parent;
  final sourceFile = File(
    '${root.path}${Platform.pathSeparator}assets${Platform.pathSeparator}icon.png',
  );
  final source = image.decodePng(sourceFile.readAsBytesSync());
  if (source == null) {
    throw StateError('Could not decode the existing app icon.');
  }

  void writeIcon(
    String path,
    int size,
    double scale, {
    bool transparent = false,
  }) {
    final canvas = image.Image(width: size, height: size, numChannels: 4);
    image.fill(
      canvas,
      color: image.ColorRgba8(11, 13, 18, transparent ? 0 : 255),
    );
    final edge = (size * scale).round();
    final artwork = image.copyResize(
      source,
      width: edge,
      height: edge,
      interpolation: image.Interpolation.cubic,
    );
    image.compositeImage(
      canvas,
      artwork,
      dstX: (size - edge) ~/ 2,
      dstY: (size - edge) ~/ 2,
    );
    final output = File.fromUri(root.uri.resolve(path));
    output.parent.createSync(recursive: true);
    output.writeAsBytesSync(image.encodePng(canvas));
  }

  writeIcon('assets/icon_launcher.png', 1024, 0.80);
  writeIcon('assets/icon_adaptive.png', 1024, 0.52, transparent: true);
  writeIcon('../client/public/app-icon.png', 512, 0.80);
}
