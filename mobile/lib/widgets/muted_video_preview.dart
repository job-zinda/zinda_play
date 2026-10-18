import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../navigation.dart';

class MutedVideoPreview extends StatefulWidget {
  final Map<String, dynamic> video;
  const MutedVideoPreview({super.key, required this.video});

  @override
  State<MutedVideoPreview> createState() => _MutedVideoPreviewState();
}

class _MutedVideoPreviewState extends State<MutedVideoPreview>
    with WidgetsBindingObserver, RouteAware {
  VideoPlayerController? _player;
  WebViewController? _web;
  bool _visible = false;
  bool _foreground = true;
  bool _routeVisible = true;
  ModalRoute<void>? _route;
  String? _error;
  int _generation = 0;
  final _visibilityKey = UniqueKey();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of<void>(context);
    if (_route != route) {
      appRouteObserver.unsubscribe(this);
      _route = route;
      if (route != null) appRouteObserver.subscribe(this, route);
    }
  }

  @override
  void didPushNext() {
    _routeVisible = false;
    _sync();
  }

  @override
  void didPopNext() {
    _routeVisible = true;
    _sync();
  }

  @override
  void didUpdateWidget(covariant MutedVideoPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.video['id'] != widget.video['id'] ||
        oldWidget.video['streamUrl'] != widget.video['streamUrl'] ||
        oldWidget.video['playbackUrl'] != widget.video['playbackUrl']) {
      _release();
      _sync();
    }
  }

  void _release() {
    _generation++;
    _player?.dispose();
    _player = null;
    _web?.loadHtmlString('<html></html>');
    _web = null;
  }

  Future<void> _sync() async {
    if (!_visible || !_foreground || !_routeVisible) {
      _release();
      if (mounted) setState(() {});
      return;
    }
    if (_player != null || _web != null) return;
    final generation = ++_generation;
    final stream = '${widget.video['streamUrl'] ?? ''}';
    final source = stream.isNotEmpty
        ? stream
        : '${widget.video['playbackUrl'] ?? ''}';
    final uri = Uri.tryParse(source);
    if (uri == null || !['http', 'https'].contains(uri.scheme)) {
      setState(() => _error = 'Preview unavailable. Tap to watch.');
      return;
    }
    try {
      _error = null;
      if (uri.host == 'iframe.mediadelivery.net' &&
          uri.path.startsWith('/embed/')) {
        final controller = WebViewController()
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(Colors.black);
        _web = controller;
        await controller.loadRequest(
          uri.replace(
            queryParameters: {
              ...uri.queryParameters,
              'autoplay': 'true',
              'muted': 'true',
              'loop': 'true',
              'controls': 'false',
            },
          ),
        );
      } else {
        final controller = VideoPlayerController.networkUrl(uri);
        _player = controller;
        await controller.initialize();
        if (!mounted || generation != _generation) return;
        await controller.setVolume(0);
        await controller.setLooping(true);
        if (!mounted || generation != _generation) return;
        await controller.play();
      }
      if (mounted && generation == _generation) setState(() {});
    } catch (error) {
      if (!mounted || generation != _generation) return;
      _release();
      setState(() => _error = 'Preview unavailable. Tap to watch.');
      debugPrint('Muted preview failed: $error');
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    appRouteObserver.unsubscribe(this);
    _release();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => VisibilityDetector(
    key: _visibilityKey,
    onVisibilityChanged: (info) {
      final visible = info.visibleFraction >= .5;
      if (visible == _visible) return;
      _visible = visible;
      _sync();
    },
    child: IgnorePointer(
      child: ColoredBox(
        color: const Color(0xFF1B1F2A),
        child: _error != null
            ? Center(
                child: Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 11),
                ),
              )
            : _web != null
            ? WebViewWidget(controller: _web!)
            : _player?.value.isInitialized == true
            ? FittedBox(
                fit: BoxFit.cover,
                child: SizedBox(
                  width: _player!.value.size.width,
                  height: _player!.value.size.height,
                  child: VideoPlayer(_player!),
                ),
              )
            : const Center(child: Icon(Icons.play_circle_outline, size: 32)),
      ),
    ),
  );
}
