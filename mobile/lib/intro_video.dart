import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import 'api.dart';
import 'theme.dart';

// Creator self-introduction video pinned to a profile. Loads only after the viewer taps it.
class IntroVideoPlayer extends StatefulWidget {
  final String url;
  const IntroVideoPlayer({super.key, required this.url});
  @override
  State<IntroVideoPlayer> createState() => _IntroVideoPlayerState();
}

class _IntroVideoPlayerState extends State<IntroVideoPlayer> {
  VideoPlayerController? _c;
  bool _loading = false;
  String? _error;

  Future<void> _open() async {
    setState(() => _loading = true);
    final c = VideoPlayerController.networkUrl(Uri.parse(assetUrl(widget.url)));
    try {
      await c.initialize();
      await c.play();
      c.addListener(() => mounted ? setState(() {}) : null);
      setState(() => _c = c);
    } catch (_) {
      await c.dispose();
      setState(() => _error = 'Could not play the intro video.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void didUpdateWidget(IntroVideoPlayer old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url) {
      _c?.dispose();
      _c = null;
    }
  }

  @override
  void dispose() {
    _c?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    if (c == null) {
      return Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          onPressed: _loading ? null : _open,
          icon: _loading ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.play_circle_outline),
          label: Text(_error ?? 'Watch intro'),
          style: OutlinedButton.styleFrom(foregroundColor: _error == null ? kPurple : Colors.redAccent),
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: AspectRatio(
        aspectRatio: c.value.aspectRatio,
        child: GestureDetector(
          onTap: () => c.value.isPlaying ? c.pause() : c.play(),
          child: Stack(fit: StackFit.expand, children: [
            VideoPlayer(c),
            if (!c.value.isPlaying) const Center(child: Icon(Icons.play_circle_fill, size: 56, color: Colors.white70)),
            Positioned(left: 0, right: 0, bottom: 0, child: VideoProgressIndicator(c, allowScrubbing: true, colors: const VideoProgressColors(playedColor: kPurple))),
          ]),
        ),
      ),
    );
  }
}

// Studio card where a creator uploads, replaces or removes the pinned intro video.
class IntroManagerCard extends StatefulWidget {
  final String url;
  final ValueChanged<String> onChanged;
  const IntroManagerCard({super.key, required this.url, required this.onChanged});
  @override
  State<IntroManagerCard> createState() => _IntroManagerCardState();
}

class _IntroManagerCardState extends State<IntroManagerCard> {
  double? _progress;
  String? _error;

  Future<void> _pick() async {
    final picked = await FilePicker.pickFile(type: FileType.video);
    final path = picked?.path;
    if (path == null) return;
    final ext = path.split('.').last.toLowerCase();
    const types = {'mp4': 'video/mp4', 'webm': 'video/webm'};
    if (!types.containsKey(ext)) {
      setState(() => _error = 'Choose an MP4 or WebM video.');
      return;
    }
    final file = File(path);
    if (await file.length() > 100 * 1024 * 1024) {
      setState(() => _error = 'Intro videos are limited to 100 MB.');
      return;
    }
    setState(() {
      _error = null;
      _progress = 0;
    });
    try {
      final data = await Api.instance.uploadFile('PUT', '/creator/intro-video', file, types[ext]!, onProgress: (p) => setState(() => _progress = p)) as Map;
      widget.onChanged('${data['introVideoUrl']}');
    } catch (e) {
      _error = '$e';
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  Future<void> _remove() async {
    try {
      await Api.instance.delete('/creator/intro-video');
      widget.onChanged('');
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final has = widget.url.isNotEmpty;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Self-introduction video', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 4),
          const Text('Pinned to your profile so viewers can meet you. MP4 or WebM, up to 100 MB.', style: TextStyle(color: Colors.white60, fontSize: 12)),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))),
          if (has) ...[const SizedBox(height: 10), IntroVideoPlayer(key: ValueKey(widget.url), url: widget.url)],
          if (_progress != null) Padding(padding: const EdgeInsets.only(top: 10), child: LinearProgressIndicator(value: _progress)),
          const SizedBox(height: 6),
          Row(children: [
            TextButton.icon(onPressed: _progress == null ? _pick : null, icon: const Icon(Icons.upload), label: Text(has ? 'Replace intro' : 'Upload intro')),
            if (has) TextButton.icon(onPressed: _progress == null ? _remove : null, icon: const Icon(Icons.delete_outline), label: const Text('Remove')),
          ]),
        ]),
      ),
    );
  }
}
