import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
import 'package:visibility_detector/visibility_detector.dart';

import 'api.dart';
import 'navigation.dart';
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
      _cache = raw == null
          ? []
          : (jsonDecode(raw) as List).map((e) => '$e').toList();
    } catch (_) {
      _cache = [];
    }
    return _cache!;
  }

  static Future<void> record(dynamic categoryId) =>
      _pending = _record(categoryId);

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
      return raw == null
          ? []
          : (jsonDecode(raw) as List).map((e) => '$e').toList();
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

  static Future<bool> claim(Map<String, dynamic> ad, {String? ticket}) async {
    final result = await Api.instance.post(
      '/ads/${ad['id']}/impression',
      ticket == null ? null : {'ticket': ticket},
    );
    return (result as Map)['accepted'] == true;
  }

  static Future<List<Map<String, dynamic>>> fetch(String placement) async {
    try {
      final interests = Uri.encodeQueryComponent(
        (await Interests.read()).join(','),
      );
      final data = await Api.instance.get(
        '/ads?placement=$placement&interests=$interests',
      );
      return (data as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
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

  static Future<void> open(Map<String, dynamic> ad, {String? url}) async {
    url ??= '${ad['targetUrl'] ?? ''}';
    if (url.isEmpty) return;
    track('${ad['id']}', 'click');
    if (!await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    )) {
      throw ApiException('The advertiser link could not be opened.');
    }
  }

  static Map<String, dynamic> pick(List<Map<String, dynamic>> ads) =>
      ads[Random().nextInt(ads.length)];
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
    AdsApi.fetch(widget.placement)
        .then((ads) async {
          if (!mounted || ads.isEmpty) return;
          final ad = AdsApi.pick(ads);
          if (!await AdsApi.claim(ad) || !mounted) return;
          setState(() => _ad = ad);
        })
        .catchError((Object error) {
          debugPrint('Banner delivery failed: $error');
        });
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
          child: Stack(
            children: [
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
            ],
          ),
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
    decoration: BoxDecoration(
      color: Colors.black87,
      borderRadius: BorderRadius.circular(5),
    ),
    child: const Text(
      'Ad',
      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
    ),
  );
}

// Plays an admin video ad before the real player. Skippable ads unlock Skip after the admin's delay.
class PlayerGate extends StatefulWidget {
  final WidgetBuilder builder;
  final String placement;
  final bool active;
  final VoidCallback? onDone;
  const PlayerGate({
    super.key,
    required this.builder,
    this.placement = 'video',
    this.active = true,
    this.onDone,
  });
  @override
  State<PlayerGate> createState() => _PlayerGateState();
}

class _PlayerGateState extends State<PlayerGate>
    with WidgetsBindingObserver, RouteAware {
  bool _loading = true;
  bool _done = false;
  Map<String, dynamic>? _ad;
  VideoPlayerController? _video;
  Map<String, dynamic>? _ticket;
  int _watchedMs = 0;
  int _lastPosition = 0;
  bool _visible = true;
  bool _completing = false;
  bool _ended = false;
  bool _started = false;
  bool _routeVisible = true;
  bool _onScreen = true;
  ModalRoute<void>? _route;
  String? _error;
  bool get _canPlay => widget.active && _visible && _routeVisible && _onScreen;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.active) _start();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of<void>(context);
    if (route != _route) {
      appRouteObserver.unsubscribe(this);
      _route = route;
      if (route != null) appRouteObserver.subscribe(this, route);
    }
  }

  @override
  void didUpdateWidget(PlayerGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !_started) _start();
    if (!_canPlay) _video?.pause();
  }

  @override
  void didPushNext() {
    _routeVisible = false;
    _video?.pause();
  }

  @override
  void didPopNext() {
    _routeVisible = true;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _visible = state == AppLifecycleState.resumed;
    if (!_visible) _video?.pause();
  }

  Future<void> _start() async {
    if (_started) return;
    _started = true;
    final ads = AdsApi.dueVideos(await AdsApi.fetch(widget.placement));
    if (!mounted) return;
    if (ads.isEmpty) return _finish();
    final ad = AdsApi.pick(ads);
    final controller = VideoPlayerController.networkUrl(
      Uri.parse(assetUrl('${ad['mediaUrl']}')),
    );
    try {
      await controller.initialize().timeout(const Duration(seconds: 25));
    } catch (error) {
      debugPrint('Video ad initialization failed: $error');
      await controller.dispose();
      if (mounted) _finish();
      return;
    }
    if (!mounted) {
      await controller.dispose();
      return;
    }
    try {
      if (ad['creatorVideoId'] != null) {
        _ticket = Map<String, dynamic>.from(
          await Api.instance.post('/ads/${ad['id']}/view-start') as Map,
        );
      }
      if (!await AdsApi.claim(ad, ticket: _ticket?['ticket'] as String?)) {
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
      if (_canPlay) await controller.play();
    } catch (error) {
      if (mounted) setState(() => _error = 'Could not play this ad: $error');
    }
  }

  void _tick() {
    final v = _video;
    if (v == null || !mounted || _done) return;
    final value = v.value;
    final position = value.position.inMilliseconds;
    final delta = position - _lastPosition;
    _lastPosition = position;
    final ended =
        value.duration > Duration.zero && value.position >= value.duration;
    if (_canPlay &&
        !value.isBuffering &&
        (value.isPlaying || ended) &&
        delta > 0 &&
        delta < 1500) {
      _watchedMs += delta;
    }
    if (value.hasError) {
      debugPrint('Video ad playback failed: ${value.errorDescription}');
      _finish();
      return;
    }
    if (ended) {
      _complete();
      return;
    }
    setState(() {});
  }

  Future<void> _complete() async {
    if (_completing) return;
    _completing = true;
    final ticket = _ticket;
    final minimum = (ticket?['minimumWatchMs'] as num?)?.toInt();
    if (ticket != null && minimum != null && _watchedMs >= minimum - 250) {
      try {
        await Api.instance.post('/ads/${_ad!['id']}/view', {
          'ticket': ticket['ticket'],
        });
      } catch (error) {
        debugPrint('Creator ad earning tracking failed: $error');
      }
    }
    if (mounted) {
      if ('${_ad!['targetUrl'] ?? ''}'.isNotEmpty ||
          '${_ad!['productUrl'] ?? ''}'.isNotEmpty) {
        setState(() => _ended = true);
      } else {
        _finish();
      }
    }
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
      widget.onDone?.call();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    appRouteObserver.unsubscribe(this);
    _video?.removeListener(_tick);
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return VisibilityDetector(
      key: ObjectKey(this),
      onVisibilityChanged: (info) {
        _onScreen = info.visibleFraction >= 0.5;
        if (!_canPlay) _video?.pause();
      },
      child: _buildContent(context),
    );
  }

  Widget _buildContent(BuildContext context) {
    if (_done || (!_started && !widget.active)) return widget.builder(context);
    final ad = _ad;
    final video = _video;
    if (_loading || ad == null || video == null) {
      return const ColoredBox(
        color: Colors.black,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final value = video.value;
    final elapsed = value.position.inMilliseconds / 1000;
    final total = value.duration.inMilliseconds / 1000;
    final skippable = ad['skippable'] != false;
    final skipAt = min(
      ((ad['skipAfterSeconds'] as num?) ?? 20).toDouble(),
      total,
    );
    final canSkip = skippable && elapsed >= skipAt;
    final remaining = max(0, (total - elapsed).ceil());
    if (_ended) {
      return ColoredBox(
        color: const Color(0xFF100B19),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const Positioned(left: 8, top: 8, child: _AdLabel()),
            Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Card(
                    color: const Color(0xFF211A31),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(24),
                      side: const BorderSide(color: Colors.white24),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text(
                            'AD FINISHED',
                            style: TextStyle(
                              color: Color(0xFFD8B4FE),
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.4,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            '${ad['title'] ?? 'Advertisement'}',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          if ('${ad['description'] ?? ''}'.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Text(
                              '${ad['description']}',
                              textAlign: TextAlign.center,
                            ),
                          ],
                          const SizedBox(height: 20),
                          if ('${ad['targetUrl'] ?? ''}'.isNotEmpty)
                            SizedBox(
                              width: double.infinity,
                              child: GradientButton(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 22,
                                  vertical: 16,
                                ),
                                onPressed: () => AdsApi.open(ad),
                                child: const Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.storefront_outlined, size: 20),
                                    SizedBox(width: 10),
                                    Text(
                                      'Visit advertiser',
                                      style: TextStyle(
                                        fontSize: 17,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    SizedBox(width: 8),
                                    Icon(Icons.open_in_new, size: 17),
                                  ],
                                ),
                              ),
                            ),
                          if ('${ad['productUrl'] ?? ''}'.isNotEmpty) ...[
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton.icon(
                                onPressed: () =>
                                    AdsApi.open(ad, url: '${ad['productUrl']}'),
                                icon: const Icon(Icons.shopping_bag_outlined),
                                label: const Text(
                                  'View product',
                                  style: TextStyle(fontWeight: FontWeight.w700),
                                ),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 14,
                                  ),
                                ),
                              ),
                            ),
                          ],
                          const SizedBox(height: 10),
                          TextButton.icon(
                            onPressed: _finish,
                            icon: const Icon(Icons.skip_next_rounded),
                            label: const Text('Skip ad ›'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return ColoredBox(
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Center(
            child: AspectRatio(
              aspectRatio: value.aspectRatio,
              child: VideoPlayer(video),
            ),
          ),
          const Positioned(left: 8, top: 8, child: _AdLabel()),
          if ('${ad['targetUrl'] ?? ''}'.isNotEmpty)
            Positioned(
              left: 10,
              top: widget.placement == 'simply' ? 64 : 38,
              right: 64,
              child: Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF7C3AED),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    minimumSize: const Size(0, 36),
                    textStyle: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  onPressed: () async {
                    await video.pause();
                    try {
                      await AdsApi.open(ad);
                    } catch (error) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Could not open advertiser: $error'),
                          ),
                        );
                      }
                    }
                  },
                  icon: const Icon(Icons.open_in_new, size: 15),
                  label: const Text('Visit advertiser'),
                ),
              ),
            ),
          if (_error != null)
            Center(
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!),
                      TextButton(
                        onPressed: _finish,
                        child: const Text('Continue to video'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (!value.isPlaying)
            Positioned(
              right: 10,
              top: widget.placement == 'simply' ? 64 : 38,
              child: IconButton.filled(
                tooltip: 'Play ad',
                iconSize: 24,
                onPressed: _canPlay ? video.play : null,
                icon: const Icon(Icons.play_arrow_rounded),
              ),
            ),
          Positioned(
            right: 10,
            bottom: 10,
            child: skippable
                ? FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: canSkip ? kPurple : Colors.black87,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      minimumSize: Size.zero,
                    ),
                    onPressed: canSkip ? _finish : null,
                    child: Text(
                      canSkip
                          ? 'Skip ad ›'
                          : 'Skip in ${max(1, (skipAt - elapsed).ceil())}s',
                      style: const TextStyle(fontSize: 12, color: Colors.white),
                    ),
                  )
                : Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black87,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Video starts in ${remaining}s',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class HomeVideoAd extends StatefulWidget {
  const HomeVideoAd({super.key});

  @override
  State<HomeVideoAd> createState() => _HomeVideoAdState();
}

class _HomeVideoAdState extends State<HomeVideoAd> {
  bool _active = false;
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    if (_done) return const SizedBox.shrink();
    return VisibilityDetector(
      key: ObjectKey(this),
      onVisibilityChanged: (info) {
        final active = info.visibleFraction >= 0.5;
        if (mounted && active != _active) setState(() => _active = active);
      },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: PlayerGate(
              placement: 'home',
              active: _active,
              onDone: () {
                if (mounted) setState(() => _done = true);
              },
              builder: (_) => const SizedBox.shrink(),
            ),
          ),
        ),
      ),
    );
  }
}
