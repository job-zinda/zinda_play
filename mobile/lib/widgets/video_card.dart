import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../api.dart';
import '../theme.dart';

String formatDuration(num? seconds) {
  final total = (seconds ?? 0).floor();
  if (total <= 0) return '';
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = (total % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$s' : '$m:$s';
}

class VideoCard extends StatelessWidget {
  final Map<String, dynamic> video;
  final VoidCallback onTap;
  final VoidCallback? onCreator;
  const VideoCard({super.key, required this.video, required this.onTap, this.onCreator});

  @override
  Widget build(BuildContext context) {
    final thumb = assetUrl(video['thumbnailUrl'] as String?);
    final creator = video['creatorProfile'] as Map<String, dynamic>?;
    final duration = formatDuration(video['durationSeconds'] as num?);
    final views = (video['views'] as num?) ?? 0;
    final photo = assetUrl(creator?['profilePhotoUrl'] as String?);

    return InkWell(
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: Stack(fit: StackFit.expand, children: [
              thumb.isEmpty
                  ? Container(color: const Color(0xFF1B1F2A), child: const Icon(Icons.play_circle_fill, size: 48))
                  : Image.network(thumb, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(color: const Color(0xFF1B1F2A))),
              if (video['isSponsored'] == true) Positioned(left: 8, top: 8, child: _chip('SPONSORED')),
              if (duration.isNotEmpty) Positioned(right: 8, bottom: 8, child: _chip(duration)),
            ]),
          ),
        ),
        // View counter sits to the left, just under the thumbnail.
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 6, 4, 0),
          child: Row(children: [
            const Icon(Icons.remove_red_eye_outlined, size: 12, color: Colors.white70),
            const SizedBox(width: 4),
            Text('$views views', style: const TextStyle(fontSize: 11, color: Colors.white70)),
            const Spacer(),
            InkWell(
              onTap: () => SharePlus.instance.share(ShareParams(text: '${video['title']} - watch on Zinda Play\n$apiBase/share/video/${video['id']}')),
              child: const Padding(padding: EdgeInsets.all(3), child: Icon(Icons.share_outlined, size: 16, color: Colors.white70)),
            ),
            InkWell(
              onTap: () => _menu(context),
              child: const Padding(padding: EdgeInsets.all(3), child: Icon(Icons.more_vert, size: 16, color: Colors.white70)),
            ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            GestureDetector(
              onTap: onCreator,
              child: CircleAvatar(
                radius: 11,
                backgroundImage: photo.isEmpty ? null : NetworkImage(photo),
                child: photo.isEmpty ? const Icon(Icons.person, size: 13) : null,
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${video['title'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                if (creator != null)
                  Text('${creator['displayName'] ?? creator['username']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: Colors.white60)),
              ]),
            ),
          ]),
        ),
      ]),
    );
  }

  void _menu(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: kPanel,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.share_outlined),
            title: const Text('Share'),
            onTap: () {
              Navigator.pop(ctx);
              SharePlus.instance.share(ShareParams(text: '${video['title']} - watch on Zinda Play\n$apiBase/share/video/${video['id']}'));
            },
          ),
          if (onCreator != null)
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('View creator'),
              onTap: () {
                Navigator.pop(ctx);
                onCreator!();
              },
            ),
        ]),
      ),
    );
  }

  Widget _chip(String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(6)),
        child: Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
      );
}
