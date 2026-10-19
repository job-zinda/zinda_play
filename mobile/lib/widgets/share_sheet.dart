import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../public_links.dart';

/// Shows the creator's photo and name before sharing a video or profile link.
Future<void> showShareSheet(
  BuildContext context, {
  required String heading,
  required String title,
  required String url,
  Map? creator,
}) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => ShareSheet(
      heading: heading,
      title: title,
      url: url,
      creator: creator,
      hostContext: context,
    ),
  );
}

Future<void> showVideoShareSheet(BuildContext context, Map video) {
  final creator = video['creatorProfile'];
  return showShareSheet(
    context,
    heading: 'Share video',
    title: '${video['title'] ?? 'Video'}',
    url: videoShareUrl('${video['id']}'),
    creator: creator is Map ? creator : null,
  );
}

Future<void> showCreatorShareSheet(BuildContext context, Map creator) {
  final name = '${creator['displayName'] ?? creator['username'] ?? 'Creator'}';
  return showShareSheet(
    context,
    heading: 'Share profile',
    title: '$name on Zinda Play',
    url: creatorShareUrl('${creator['id']}'),
    creator: creator,
  );
}

class ShareSheet extends StatelessWidget {
  final String heading;
  final String title;
  final String url;
  final Map? creator;
  final BuildContext hostContext;

  const ShareSheet({
    super.key,
    required this.heading,
    required this.title,
    required this.url,
    required this.creator,
    required this.hostContext,
  });

  Future<void> _whatsApp(BuildContext context) async {
    final uri = Uri.parse(
      'https://wa.me/?text=${Uri.encodeComponent('$title\n$url')}',
    );
    Navigator.pop(context);
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw Exception('WhatsApp is not available.');
      }
    } catch (error) {
      if (hostContext.mounted) {
        ScaffoldMessenger.of(hostContext).showSnackBar(
          SnackBar(content: Text('Could not open WhatsApp: $error')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = creator;
    final name = c == null
        ? 'Zinda Play'
        : '${c['displayName'] ?? c['username'] ?? 'Creator'}';
    final username = c == null ? '' : '${c['username'] ?? ''}';
    final photo = c == null ? '' : assetUrl(c['profilePhotoUrl'] as String?);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              heading,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                CircleAvatar(
                  key: const ValueKey('share-creator-avatar'),
                  radius: 28,
                  backgroundImage: photo.isEmpty ? null : NetworkImage(photo),
                  onBackgroundImageError: photo.isEmpty ? null : (_, _) {},
                  child: photo.isEmpty ? const Icon(Icons.person, size: 28) : null,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      if (username.isNotEmpty)
                        Text(
                          '@$username',
                          style: const TextStyle(color: Colors.white60),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(title, maxLines: 3, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _ShareAction(
                  icon: Icons.share,
                  label: 'Share',
                  onTap: () {
                    Navigator.pop(context);
                    sharePublicLink(hostContext, title, url);
                  },
                ),
                _ShareAction(
                  icon: Icons.chat,
                  label: 'WhatsApp',
                  color: const Color(0xFF25D366),
                  onTap: () => _whatsApp(context),
                ),
                _ShareAction(
                  icon: Icons.copy,
                  label: 'Copy link',
                  onTap: () {
                    Navigator.pop(context);
                    copyPublicLink(hostContext, url);
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}


class _ShareAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;
  const _ShareAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final tint = color ?? Theme.of(context).colorScheme.primary;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: tint.withValues(alpha: 0.18),
              child: Icon(icon, color: tint),
            ),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
