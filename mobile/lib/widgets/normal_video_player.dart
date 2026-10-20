import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../navigation.dart';
import '../playback.dart';

class NormalVideoPlayer extends StatefulWidget {
  final String source;
  const NormalVideoPlayer({super.key, required this.source});

  @override
  State<NormalVideoPlayer> createState() => _NormalVideoPlayerState();
}

class _NormalVideoPlayerState extends State<NormalVideoPlayer>
    with WidgetsBindingObserver, RouteAware {
  late final VideoPlayerController _controller;
  final _playerChanges =
      ValueNotifier<({VideoPlayerValue playback, String? error})>((
        playback: VideoPlayerValue.uninitialized(),
        error: null,
      ));
  ModalRoute<void>? _route;
  String? _error;
  bool _fullscreen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.source));
    _controller.addListener(_refresh);
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      await _controller.initialize().timeout(const Duration(seconds: 15));
    } catch (error) {
      if (mounted) {
        _error = 'Could not load the video: $error';
        _playerChanges.value = (playback: _controller.value, error: _error);
      }
    }
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
  void didPushNext() {
    if (!_fullscreen) _controller.pause();
  }

  Future<void> _openFullscreen() async {
    _fullscreen = true;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => Scaffold(
          backgroundColor: Colors.black,
          body: SafeArea(
            child: AnimatedBuilder(
              animation: _playerChanges,
              builder: (_, _) => _buildPlayer(fullscreen: true),
            ),
          ),
        ),
      ),
    );
    _fullscreen = false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _controller.pause();
  }

  void _refresh() {
    final value = _controller.value;
    final previous = _playerChanges.value.playback;
    if (mounted &&
        (value.isInitialized != previous.isInitialized ||
            value.isPlaying != previous.isPlaying ||
            value.isBuffering != previous.isBuffering ||
            value.playbackSpeed != previous.playbackSpeed ||
            value.errorDescription != previous.errorDescription ||
            value.size != previous.size)) {
      _playerChanges.value = (playback: value, error: _error);
    }
  }

  Future<void> _change(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      if (mounted) {
        _error = 'Playback failed: $error';
        _playerChanges.value = (playback: _controller.value, error: _error);
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    appRouteObserver.unsubscribe(this);
    _controller.removeListener(_refresh);
    _controller.dispose();
    _playerChanges.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _playerChanges,
    builder: (_, _) => _buildPlayer(),
  );

  Widget _buildPlayer({bool fullscreen = false}) {
    final value = _controller.value;
    final error = _error ?? value.errorDescription;
    return ColoredBox(
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (value.isInitialized)
            Center(
              child: AspectRatio(
                aspectRatio: value.aspectRatio,
                child: VideoPlayer(_controller),
              ),
            ),
          if (error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(error, textAlign: TextAlign.center),
              ),
            )
          else if (!value.isInitialized || value.isBuffering)
            const Center(child: CircularProgressIndicator()),
          if (value.isInitialized) ...[
            Positioned(
              top: 0,
              right: 4,
              child: PopupMenuButton<double>(
                tooltip: 'Playback speed',
                initialValue: value.playbackSpeed,
                onSelected: (speed) =>
                    _change(() => _controller.setPlaybackSpeed(speed)),
                itemBuilder: (_) => playbackSpeeds
                    .map(
                      (speed) => PopupMenuItem(
                        value: speed,
                        child: Text(speed == 1 ? 'Normal (1x)' : '${speed}x'),
                      ),
                    )
                    .toList(),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  color: Colors.black87,
                  child: Text(
                    '${value.playbackSpeed}x',
                    style: const TextStyle(color: Colors.white),
                  ),
                ),
              ),
            ),
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: ColoredBox(
                color: Colors.black87,
                child: Row(
                  children: [
                    IconButton(
                      tooltip: value.isPlaying ? 'Pause video' : 'Play video',
                      icon: Icon(
                        value.isPlaying ? Icons.pause : Icons.play_arrow,
                        color: Colors.white,
                      ),
                      onPressed: () => _change(
                        value.isPlaying ? _controller.pause : _controller.play,
                      ),
                    ),
                    Expanded(
                      child: VideoProgressIndicator(
                        _controller,
                        allowScrubbing: true,
                        padding: const EdgeInsets.symmetric(
                          vertical: 20,
                          horizontal: 8,
                        ),
                        colors: const VideoProgressColors(
                          playedColor: Color(0xFFAC6CFF),
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: fullscreen ? 'Exit fullscreen' : 'Fullscreen',
                      icon: Icon(
                        fullscreen ? Icons.fullscreen_exit : Icons.fullscreen,
                        color: Colors.white,
                      ),
                      onPressed: () => fullscreen
                          ? Navigator.of(context).pop()
                          : _openFullscreen(),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
