import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/video_card.dart';
import 'creator_screen.dart';
import 'watch_screen.dart';

// A web series or playlist built from videos that share a collection name.
class VideoCollection {
  final String name;
  final String type;
  final List<Map<String, dynamic>> videos;
  VideoCollection(this.name, this.type, this.videos);

  String get typeLabel => type == 'series' ? 'Web series' : 'Playlist';
  String get thumbnail => assetUrl(videos.first['thumbnailUrl'] as String?);

  static List<VideoCollection> group(List<Map<String, dynamic>> videos) {
    final groups = <String, VideoCollection>{};
    for (final v in videos) {
      final name = '${v['collectionName'] ?? ''}'.trim();
      if (name.isEmpty || v['isSponsored'] == true) continue;
      final creator = v['creatorProfile'] is Map ? '${(v['creatorProfile'] as Map)['id'] ?? ''}' : '';
      final key = '$creator|${name.toLowerCase()}';
      groups.putIfAbsent(key, () => VideoCollection(name, '${v['collectionType'] ?? 'playlist'}', [])).videos.add(v);
    }
    for (final g in groups.values) {
      g.videos.sort((a, b) {
        final ea = (a['episodeNumber'] as num?) ?? 1 << 30;
        final eb = (b['episodeNumber'] as num?) ?? 1 << 30;
        return ea.compareTo(eb);
      });
    }
    return groups.values.toList();
  }
}

class CollectionCard extends StatelessWidget {
  final VideoCollection collection;
  final VoidCallback onTap;
  const CollectionCard({super.key, required this.collection, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final thumb = collection.thumbnail;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: Stack(fit: StackFit.expand, children: [
              Container(color: kPanel),
              if (thumb.isNotEmpty) Image.network(thumb, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink()),
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                width: 52,
                child: Container(
                  color: const Color(0xCC08090E),
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    const Icon(Icons.playlist_play_rounded, size: 24),
                    Text('${collection.videos.length}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  ]),
                ),
              ),
            ]),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 6, 4, 0),
          child: Text(collection.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 2, 4, 0),
          child: Text('${collection.typeLabel} • ${collection.videos.length} video${collection.videos.length == 1 ? '' : 's'}', style: const TextStyle(fontSize: 11, color: kMuted)),
        ),
      ]),
    );
  }
}

class CollectionScreen extends StatelessWidget {
  final VideoCollection collection;
  const CollectionScreen({super.key, required this.collection});

  @override
  Widget build(BuildContext context) {
    final first = collection.videos.first;
    return Scaffold(
      appBar: AppBar(title: Text(collection.name, overflow: TextOverflow.ellipsis)),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Text('${collection.typeLabel} • ${collection.videos.length} video${collection.videos.length == 1 ? '' : 's'}', style: const TextStyle(color: kMuted)),
        const SizedBox(height: 12),
        GradientButton(
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => WatchScreen(video: first))),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.play_arrow_rounded),
            SizedBox(width: 6),
            Text('Play from start', style: TextStyle(fontWeight: FontWeight.w700)),
          ]),
        ),
        const SizedBox(height: 14),
        for (final v in collection.videos)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (v['episodeNumber'] != null)
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 4),
                  child: Text('Episode ${v['episodeNumber']}', style: const TextStyle(fontSize: 12, color: kPurple, fontWeight: FontWeight.w700)),
                ),
              VideoCard(
                video: v,
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => WatchScreen(video: v))),
                onCreator: v['creatorProfile'] == null
                    ? null
                    : () => Navigator.push(context, MaterialPageRoute(builder: (_) => CreatorScreen(creator: Map<String, dynamic>.from(v['creatorProfile'] as Map)))),
              ),
            ]),
          ),
      ]),
    );
  }
}
