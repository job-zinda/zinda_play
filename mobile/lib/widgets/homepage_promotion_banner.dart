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
    if (banner['enabled'] != true) return const SizedBox.shrink();
    final image = '${banner['imageUrl'] ?? ''}';
    final description = '${banner['description'] ?? ''}';
    final label = '${banner['buttonLabel'] ?? ''}';
    final url = Uri.tryParse('${banner['buttonUrl'] ?? ''}');
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (image.isNotEmpty)
              AspectRatio(
                aspectRatio: 3,
                child: Image.network(
                  assetUrl(image),
                  fit: BoxFit.contain,
                  excludeFromSemantics: true,
                  errorBuilder: (_, _, _) =>
                      const Center(child: Text('Banner image unavailable')),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('FEATURED'),
                  const SizedBox(height: 12),
                  Text(
                    '${banner['title'] ?? ''}',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text(description),
                  ],
                  if (label.isNotEmpty &&
                      url != null &&
                      ['http', 'https'].contains(url.scheme)) ...[
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => _open(context),
                      child: Text(label),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
