import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';

class HomepagePromotionBanner extends StatelessWidget {
  final Map<String, dynamic> banner;
  const HomepagePromotionBanner({super.key, required this.banner});

  Future<void> _open(BuildContext context) async {
    try {
      final uri = Uri.parse('${banner['buttonUrl']}');
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw ApiException('Could not open the banner link.');
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final image = '${banner['imageUrl'] ?? ''}'.trim();
    if (banner['enabled'] != true || image.isEmpty) {
      return const SizedBox.shrink();
    }
    final url = Uri.tryParse('${banner['buttonUrl'] ?? ''}');
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: url != null && ['http', 'https'].contains(url.scheme)
              ? () => _open(context)
              : null,
          child: AspectRatio(
            aspectRatio: 3,
            child: Image.network(
              assetUrl(image),
              fit: BoxFit.contain,
              semanticLabel: '${banner['title'] ?? 'Zinda Play banner'}',
              errorBuilder: (_, _, _) =>
                  const Center(child: Text('Banner image unavailable')),
            ),
          ),
        ),
      ),
    );
  }
}
