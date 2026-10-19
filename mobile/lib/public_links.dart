import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

const publicWebsite = 'https://zindaplay.com';
const whatsAppHelpUrl = 'https://wa.me/919847561998?text=Zindaplay';

String videoShareUrl(String id) =>
    '$publicWebsite/share/video/${Uri.encodeComponent(id)}';

String creatorShareUrl(String id) =>
    '$publicWebsite/share/creator/${Uri.encodeComponent(id)}';

String referralUrl(String code) =>
    Uri.parse(publicWebsite)
        .replace(path: '/', queryParameters: {'ref': code})
        .toString();

Future<void> sharePublicLink(
  BuildContext context,
  String title,
  String url,
) async {
  final size = MediaQuery.sizeOf(context);
  try {
    await SharePlus.instance.share(
      ShareParams(
        text: '$title\n$url',
        sharePositionOrigin: Rect.fromLTWH(0, 0, size.width, size.height / 2),
      ),
    );
  } on Exception catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not share this link: $error')),
    );
  }
}

Future<void> copyPublicLink(BuildContext context, String url) async {
  try {
    await Clipboard.setData(ClipboardData(text: url));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Link copied.')));
  } on PlatformException catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not copy this link: ${error.message}')),
    );
  }
}
