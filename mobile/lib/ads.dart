import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import 'api.dart';
import 'theme.dart';

// Categories of recently watched videos, sent with ad requests for interest targeting.
class Interests {
  static const _storage = FlutterSecureStorage();
  static const _key = 'recent_categories';
  static List<String>? _cache;

  static Future<void>? _pending;

  static Future<List<String>> read() async {
    await _pending;
    if (_cache != null) return _cache!;
    try {
      final raw = await _storage.read(key: _key);
      _cache = raw == null ? [] : (jsonDecode(raw) as List).map((e) => '$e').toList();
    } catch (_) {
      _cache = [];
    }
    return _cache!;
  }

  static Future<void> record(dynamic categoryId) => _pending = _record(categoryId);

  static Future<void> _record(dynamic categoryId) async {
    final id = '${categoryId ?? ''}';
    if (id.isEmpty || id == 'null') return;
    final previous = _cache ?? await _load();
    final list = [id, ...previous.where((e) => e != id)].take(8).toList();
    _cache = list;
    try {
      await _storage.write(key: _key, value: jsonEncode(list));
    } catch (_) {}
  }

  static Future<List<String>> _load() async {
    try {
      final raw = await _storage.read(key: _key);
      return raw == null ? [] : (jsonDecode(raw) as List).map((e) => '$e').toList();
    } catch (_) {
      return [];
    }
  }
}

class AdsApi {
  static final Map<String, int> _videoCounts = {};
  static void markDelivered(String id) => _videoCounts[id] = 0;

  static List<Map<String, dynamic>> dueVideos(List<Map<String, dynamic>> ads) {
    return ads.where((ad) {
      final id = '${ad['id']}';
      final count = (_videoCounts[id] ?? 0) + 1;
      _videoCounts[id] = count;
      return count >= ((ad['frequency'] as num?)?.toInt() ?? 1);
    }).toList();
  }

  static Future<bool> claim(Map<String, dynamic> ad) async {
    final result = await Api.instance.post('/ads/${ad['id']}/impression');
    return (result as Map)['accepted'] == true;
  }

  static Future<List<Map<String, dynamic>>> fetch(String placement) async {
    try {
      final interests = Uri.encodeQueryComponent((await Interests.read()).join(','));
      final data = await Api.instance.get('/ads?placement=$placement&interests=$interests');
      return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (error) {
      debugPrint('Ad loading failed: $error');
      return [];
    }
  }

  static Future<void> track(String id, String event) async {
    try {
      await Api.instance.post('/ads/$id/$event');
    } catch (error) {
      debugPrint('Ad tracking failed: $error');
    }
  }

  static Future<void> open(Map<String, dynamic> ad) async {
    final url = '${ad['targetUrl'] ?? ''}';
    if (url.isEmpty) return;
    track('${ad['id']}', 'click');
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  static Map<String, dynamic> pick(List<Map<String, dynamic>> ads) => ads[Random().nextInt(ads.length)];
}

// Image banner for the top, middle or bottom of the home screen.
class AdBanner extends StatefulWidget {
  final String placement;
  const AdBanner({super.key, required this.placement});
  @override
  State<AdBanner> createState() => _AdBannerState();
}

class _AdBannerState extends State<AdBanner> {
  Map<String, dynamic>? _ad;

  @override
  void initState() {
    super.initState();
    AdsApi.fetch(widget.placement).then((ads) async {
      if (!mounted || ads.isEmpty) return;
      final ad = AdsApi.pick(ads);
      if (!await AdsApi.claim(ad) || !mounted) return;
      setState(() => _ad = ad);
    }).catchError((Object error) { debugPrint('Banner delivery failed: $error'); });
  }

  @override
  Widget build(BuildContext context) {
    final ad = _ad;
    if (ad == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
      child: GestureDetector(
        onTap: () => AdsApi.open(ad),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: Stack(children: [
            AspectRatio(
              aspectRatio: 3,
              child: Image.network(
                assetUrl('${ad['mediaUrl']}'),
                width: double.infinity,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
            const Positioned(left: 8, top: 8, child: _AdLabel()),
          ]),
        ),
      ),
    );
  }
}

class _AdLabel extends StatelessWidget {
  const _AdLabel();
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(5)),
        child: const Text('Ad', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700)),
      );
}

// Plays an admin video ad before the real player. Skippable ads unlock Skip after the admin's delay.
class PlayerGate extends StatefulWidget {
  final WidgetBuilder builder;
  const PlayerGate({super.key, required this.builder});
  @override
  State<PlayerGate> createState() => _PlayerGateState();
}

class _PlayerGateState extends State<PlayerGate> {
  bool _loading = true;
  bool _done = false;
  Map<String, dynamic>? _ad;
  VideoPlayerController? _video;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final ads = AdsApi.dueVideos(await AdsApi.fetch('video'));
    if (!mounted) return;
    if (ads.isEmpty) return _finish();
    final ad = AdsApi.pick(ads);
    final controller = VideoPlayerController.networkUrl(Uri.parse(assetUrl('${ad['mediaUrl']}')));
    try {
      await controller.initialize();
    } catch (_) {
      await controller.dispose();
      if (mounted) _finish();
      return;
    }
    if (!mounted) {
      await controller.dispose();
      return;
    }
    try {
      if (!await AdsApi.claim(ad)) {
        await controller.dispose();
        if (mounted) _finish();
        return;
      }
      AdsApi.markDelivered('${ad['id']}');
    } catch (error) {
      debugPrint('Video ad delivery failed: $error');
      await controller.dispose();
      if (mounted) _finish();
      return;
    }
    if (!mounted) {
      await controller.dispose();
      return;
    }
    controller.addListener(_tick);
    setState(() {
      _ad = ad;
      _video = controller;
      _loading = false;
    });
    try {
      await controller.play();
    } catch (_) {}
  }

  void _tick() {
    final v = _video;
    if (v == null || !mounted || _done) return;
    final value = v.value;
    if (value.hasError || (value.duration > Duration.zero && value.position >= value.duration)) {
      _finish();
      return;
    }
    setState(() {});
  }

  void _finish() {
    _video?.removeListener(_tick);
    _video?.dispose();
    _video = null;
    if (mounted) {
      setState(() {
        _done = true;
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _video?.removeListener(_tick);
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_done) return widget.builder(context);
    final ad = _ad;
    final video = _video;
    if (_loading || ad == null || video == null) {
      return const ColoredBox(color: Colors.black, child: Center(child: CircularProgressIndicator()));
    }
    final value = video.value;
    final elapsed = value.position.inMilliseconds / 1000;
    final total = value.duration.inMilliseconds / 1000;
    final skippable = ad['skippable'] != false;
    final skipAt = min(((ad['skipAfterSeconds'] as num?) ?? 20).toDouble(), total);
    final canSkip = skippable && elapsed >= skipAt;
    final remaining = max(0, (total - elapsed).ceil());
    return ColoredBox(
      color: Colors.black,
      child: Stack(fit: StackFit.expand, children: [
        Center(child: AspectRatio(aspectRatio: value.aspectRatio, child: VideoPlayer(video))),
        const Positioned(left: 8, top: 8, child: _AdLabel()),
        if (!value.isPlaying)
          Center(
            child: IconButton.filled(
              iconSize: 36,
              onPressed: video.play,
              icon: const Icon(Icons.play_arrow_rounded),
            ),
          ),
        if ('${ad['targetUrl'] ?? ''}'.isNotEmpty)
          Positioned(
            left: 10,
            bottom: 10,
            child: GradientButton(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              onPressed: () {
                video.pause();
                AdsApi.open(ad);
              },
              child: const Text('Visit advertiser', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ),
        Positioned(
          right: 10,
          bottom: 10,
          child: skippable
              ? FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: canSkip ? kPurple : Colors.black87, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), minimumSize: Size.zero),
                  onPressed: canSkip ? _finish : null,
                  child: Text(canSkip ? 'Skip ad ›' : 'Skip in ${max(1, (skipAt - elapsed).ceil())}s', style: const TextStyle(fontSize: 12, color: Colors.white)),
                )
              : Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(8)),
                  child: Text('Video starts in ${remaining}s', style: const TextStyle(fontSize: 12)),
                ),
        ),
      ]),
    );
  }
}
