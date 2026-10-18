import 'dart:async';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../api.dart';
import '../navigation.dart';
import '../shorts.dart';
import '../widgets/short_comments.dart';
import 'auth_screen.dart';

class ShortsScreen extends StatefulWidget {
  final bool saved;
  final Map<String, dynamic>? initialVideo;
  final ShortsApi? service;
  const ShortsScreen({
    super.key,
    this.saved = false,
    this.initialVideo,
    this.service,
  });
  @override
  State<ShortsScreen> createState() => _ShortsScreenState();
}

class _ShortsScreenState extends State<ShortsScreen>
    with WidgetsBindingObserver, RouteAware {
  final _pager = PageController();
  final _playbackChanges = ValueNotifier<int>(0);
  final _items = <Map<String, dynamic>>[];
  late final ShortsApi _service = widget.service ?? ShortsApi();
  String? _cursor;
  String? _error;
  bool _loading = false;
  bool _hasMore = true;
  bool _visible = true;
  bool _routeVisible = true;
  bool _dataSaver = true;
  bool _muted = true;
  int _index = 0;
  ModalRoute<void>? _route;
  void _updatePlayback(VoidCallback update) {
    if (!mounted) return;
    setState(update);
    _playbackChanges.value++;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.initialVideo?['streamUrl'] != null) {
      _items.add(widget.initialVideo!);
    }
    _load();
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
    _updatePlayback(() => _routeVisible = false);
  }

  @override
  void didPopNext() {
    _updatePlayback(() => _routeVisible = true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _updatePlayback(() => _visible = state == AppLifecycleState.resumed);
  }

  Future<void> _load() async {
    if (_loading || !_hasMore) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_items.isEmpty && widget.initialVideo != null && _cursor == null) {
        final detail = await Api.instance.get(
          '/shorts/${widget.initialVideo!['id']}',
        ) as Map;
        if (!mounted) return;
        setState(() => _items.add(Map<String, dynamic>.from(detail)));
      }
      final page = await _service.page(cursor: _cursor, saved: widget.saved);
      if (!mounted) return;
      setState(() {
        final ids = _items.map((item) => item['id']).toSet();
        _items.addAll(page.items.where((item) => ids.add(item['id'])));
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    appRouteObserver.unsubscribe(this);
    _pager.dispose();
    _playbackChanges.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    return ColoredBox(
      color: Colors.black,
      child: Stack(
        children: [
          if (_items.isNotEmpty)
            PageView.builder(
              controller: _pager,
              scrollDirection: Axis.vertical,
              allowImplicitScrolling: !_dataSaver && !reduceMotion,
              itemCount: _items.length + 1,
              onPageChanged: (index) {
                _updatePlayback(() => _index = index);
                if (index >= _items.length - 2) _load();
              },
              itemBuilder: (context, index) {
                if (index == _items.length) return _status();
                return ValueListenableBuilder<int>(
                  valueListenable: _playbackChanges,
                  builder: (_, _, _) => _ShortPlayer(
                    key: ValueKey(_items[index]['id']),
                    video: _items[index],
                    active: _visible && _routeVisible && index == _index,
                    preload:
                        _visible &&
                        _routeVisible &&
                        !_dataSaver &&
                        !reduceMotion &&
                        index == _index + 1,
                    muted: _muted,
                    onMute: () => _updatePlayback(() => _muted = !_muted),
                  ),
                );
              },
            )
          else
            Center(child: _status()),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 4, 8, 0),
              child: Row(
                children: [
                  if (Navigator.canPop(context) && widget.saved)
                    const BackButton(),
                  Expanded(
                    child: Text(
                      widget.saved ? 'Watch Later' : 'Simply',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 20,
                        shadows: [Shadow(blurRadius: 8)],
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _dataSaver
                        ? 'Data saver on: no next-video preload'
                        : 'Next-video preload enabled',
                    onPressed: () =>
                        _updatePlayback(() => _dataSaver = !_dataSaver),
                    icon: Icon(
                      _dataSaver ? Icons.data_saver_on : Icons.speed,
                      color: Colors.deepPurpleAccent,
                    ),
                  ),
                  if (!widget.saved)
                    IconButton(
                      tooltip: 'Watch Later',
                      icon: const Icon(Icons.bookmarks_outlined),
                      onPressed: () async {
                        if (!Api.instance.signedIn) {
                          await Navigator.push(
                            context,
                            MaterialPageRoute<void>(
                              builder: (_) => const AuthScreen(),
                            ),
                          );
                        }
                        if (context.mounted && Api.instance.signedIn) {
                          await Navigator.push(
                            context,
                            MaterialPageRoute<void>(
                              builder: (_) => const Scaffold(
                                body: ShortsScreen(saved: true),
                              ),
                            ),
                          );
                        }
                      },
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _status() => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_loading) ...[
            Container(
              width: 90,
              height: 160,
              decoration: BoxDecoration(
                color: const Color(0xFF171321),
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            const SizedBox(height: 16),
            const CircularProgressIndicator(),
          ] else ...[
            Text(
              _error ??
                  (_items.isEmpty
                      ? widget.saved
                            ? 'No saved Simply videos yet.'
                            : 'No Simply videos yet. Be the first to create one!'
                      : _hasMore
                      ? 'More Simply videos are available.'
                      : 'You are all caught up.'),
            ),
            const SizedBox(height: 12),
            if (_hasMore)
              FilledButton(
                onPressed: _load,
                child: Text(_error == null ? 'Load more' : 'Retry'),
              ),
            if (!_hasMore)
              TextButton(
                onPressed: () {
                  setState(() {
                    _items.clear();
                    _cursor = null;
                    _hasMore = true;
                    _index = 0;
                  });
                  if (_pager.hasClients) _pager.jumpToPage(0);
                  _load();
                },
                child: const Text('Refresh'),
              ),
          ],
        ],
      ),
    ),
  );
}

class _ShortPlayer extends StatefulWidget {
  final Map<String, dynamic> video;
  final bool active;
  final bool preload;
  final bool muted;
  final VoidCallback onMute;
  const _ShortPlayer({
    super.key,
    required this.video,
    required this.active,
    required this.preload,
    required this.muted,
    required this.onMute,
  });
  @override
  State<_ShortPlayer> createState() => _ShortPlayerState();
}

class _ShortPlayerState extends State<_ShortPlayer> {
  VideoPlayerController? _controller;
  int _generation = 0;
  bool _overlay = false;
  bool _paused = false;
  bool _busy = false;
  bool _loading = false;
  bool _liked = false;
  bool _saved = false;
  bool _following = false;
  bool _self = false;
  int _likes = 0;
  int _views = 0;
  List<Map<String, dynamic>> _comments = [];
  String? _error;
  String? _playbackError;
  String? _ticket;
  int _minimumWatchMs = 3000;
  int _watchedMs = 0;
  int _lastPosition = 0;
  bool _viewSent = false;
  bool _startingView = false;
  bool get _playing => widget.active && !_overlay && !_paused;
  String get _id => '${widget.video['id']}';
  Map<String, dynamic>? get _creator => widget.video['creatorProfile'] == null
      ? null
      : Map<String, dynamic>.from(widget.video['creatorProfile'] as Map);

  @override
  void initState() {
    super.initState();
    _views = (widget.video['views'] as num?)?.toInt() ?? 0;
    _sync();
    if (widget.active) _interactions();
  }

  @override
  void didUpdateWidget(covariant _ShortPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
    if (!oldWidget.active && widget.active) _interactions();
  }

  Future<void> _sync() async {
    if (!widget.active && !widget.preload) {
      _generation++;
      final old = _controller;
      _controller = null;
      _loading = false;
      await _release(old);
      return;
    }
    if (_controller == null && !_loading) {
      final url = Uri.tryParse('${widget.video['streamUrl'] ?? ''}');
      if (url == null || url.scheme != 'https') {
        setState(
          () => _playbackError =
              'Simply playback is unavailable. Check server CDN configuration.',
        );
        return;
      }
      final generation = ++_generation;
      _loading = true;
      _playbackError = null;
      final controller = VideoPlayerController.networkUrl(url);
      _controller = controller;
      try {
        await controller.initialize().timeout(const Duration(seconds: 25));
        if (!mounted || generation != _generation) return;
        await controller.setLooping(true);
        controller.addListener(_tick);
        _lastPosition = controller.value.position.inMilliseconds;
      } catch (error) {
        if (mounted && generation == _generation) {
          setState(() => _playbackError = 'Could not play this Simply video: $error');
        }
      } finally {
        if (mounted && generation == _generation) {
          setState(() => _loading = false);
        }
      }
    }
    final controller = _controller;
    if (!mounted || controller == null || !controller.value.isInitialized) {
      return;
    }
    try {
      await controller.setVolume(widget.muted ? 0 : 1);
      if (_playing) {
        await controller.play();
        if (!_viewSent && _ticket == null && !_startingView) _startView();
      } else {
        await controller.pause();
      }
    } catch (error) {
      if (mounted && controller == _controller) {
        setState(() => _playbackError = '$error');
      }
    }
  }

  Future<void> _startView() async {
    _startingView = true;
    try {
      final data = await Api.instance.post('/shorts/$_id/view-start') as Map;
      if (!mounted) return;
      _ticket = '${data['ticket']}';
      _minimumWatchMs = (data['minimumWatchMs'] as num).toInt();
      _watchedMs = 0;
    } catch (error) {
      if (mounted) setState(() => _error = 'View tracking: $error');
    } finally {
      _startingView = false;
    }
  }

  void _tick() {
    final controller = _controller;
    if (controller == null || !mounted) return;
    final value = controller.value;
    final position = value.position.inMilliseconds;
    final delta = position - _lastPosition;
    _lastPosition = position;
    if (_playing &&
        value.isPlaying &&
        !value.isBuffering &&
        delta > 0 &&
        delta < 1500 &&
        _ticket != null) {
      _watchedMs += delta;
      if (!_viewSent && _watchedMs >= _minimumWatchMs + 300) _countView();
    }
  }

  Future<void> _countView() async {
    _viewSent = true;
    try {
      final result = await Api.instance.post('/shorts/$_id/view', {
        'ticket': _ticket,
      }) as Map;
      if (mounted) setState(() => _views = (result['views'] as num).toInt());
    } catch (error) {
      if (mounted) setState(() => _error = 'View tracking: $error');
    }
  }

  Future<void> _interactions() async {
    try {
      final data = await Api.instance.get('/videos/$_id/interactions') as Map;
      final creator = _creator;
      final follow = creator == null
          ? null
          : await Api.instance.get('/creators/${creator['id']}/follow') as Map;
      final saved = !Api.instance.signedIn
          ? null
          : await Api.instance.get('/shorts/$_id/state') as Map;
      if (!mounted) return;
      setState(() {
        _liked = data['liked'] == true;
        _likes = (data['likeCount'] as num).toInt();
        _comments = (data['comments'] as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        _following = follow?['following'] == true;
        _self = follow?['isSelf'] == true;
        _saved = saved?['saved'] == true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _action(
    Future<void> Function() action, {
    bool signIn = true,
  }) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _overlay = true;
    });
    await _sync();
    try {
      if (signIn && !Api.instance.signedIn) {
        if (!mounted) return;
        await Navigator.push(
          context,
          MaterialPageRoute<void>(builder: (_) => const AuthScreen()),
        );
        if (!Api.instance.signedIn) return;
        await _interactions();
      }
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _overlay = false;
        });
        _sync();
      }
    }
  }

  Future<void> _like() => _action(() async {
    final result = await Api.instance.post('/videos/$_id/like') as Map;
    if (mounted) {
      setState(() {
        _liked = result['liked'] == true;
        _likes = (result['likeCount'] as num).toInt();
      });
    }
  });

  Future<void> _save() => _action(() async {
    final result =
        await (_saved
                ? Api.instance.delete('/shorts/$_id/saved')
                : Api.instance.put('/shorts/$_id/saved', {}))
            as Map;
    if (mounted) setState(() => _saved = result['saved'] == true);
  });

  Future<void> _follow() => _action(() async {
    final creator = _creator;
    if (creator == null) return;
    final path = '/creators/${creator['id']}/follow';
    final result =
        await (_following ? Api.instance.delete(path) : Api.instance.post(path))
            as Map;
    if (mounted) setState(() => _following = result['following'] == true);
  });

  Future<void> _commentSheet() => _action(() async {
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => ShortComments(id: _id, comments: _comments),
    );
    if (mounted) await _interactions();
  }, signIn: false);

  Future<void> _report() => _action(() async {
    if (!mounted) return;
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(title: Text('Report Simply video')),
            for (final reason in [
              'spam',
              'harassment',
              'inappropriate',
              'copyright',
              'other',
            ])
              ListTile(
                title: Text(reason),
                onTap: () => Navigator.pop(context, reason),
              ),
          ],
        ),
      ),
    );
    if (reason == null) return;
    await Api.instance.post('/shorts/$_id/report', {'reason': reason});
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report sent to the admin for review.')),
      );
    }
  });

  @override
  void dispose() {
    _generation++;
    unawaited(_release(_controller));
    super.dispose();
  }

  Future<void> _release(VideoPlayerController? controller) async {
    if (controller == null) return;
    try {
      if (controller.value.isInitialized) await controller.pause();
    } catch (error) {
      debugPrint('Failed to pause Short $_id: $error');
    } finally {
      await controller.dispose();
    }
  }

  Widget _button(
    String label,
    IconData icon,
    VoidCallback action, {
    Color? color,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Column(
      children: [
        IconButton(
          tooltip: label,
          onPressed: _busy ? null : action,
          icon: Icon(icon, color: color ?? Colors.white),
          style: IconButton.styleFrom(backgroundColor: Colors.black45),
        ),
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            shadows: [Shadow(blurRadius: 5)],
          ),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final creator = _creator;
    return Stack(
      fit: StackFit.expand,
      children: [
        Center(
          child: AspectRatio(
            aspectRatio: 9 / 16,
            child: GestureDetector(
              onTap: () {
                setState(() => _paused = !_paused);
                _sync();
              },
              child: controller != null && controller.value.isInitialized
                  ? VideoPlayer(controller)
                  : const ColoredBox(color: Color(0xFF15101F)),
            ),
          ),
        ),
        if (_loading) const Center(child: CircularProgressIndicator()),
        if (controller != null && controller.value.isInitialized)
          ValueListenableBuilder<VideoPlayerValue>(
            valueListenable: controller,
            builder: (_, value, _) => value.isBuffering
                ? const Center(child: CircularProgressIndicator())
                : const SizedBox.shrink(),
          ),
        if (_playbackError != null)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_playbackError!),
                  TextButton(
                    onPressed: () async {
                      final old = _controller;
                      _controller = null;
                      await old?.dispose();
                      if (mounted) _sync();
                    },
                    child: const Text('Retry playback'),
                  ),
                ],
              ),
            ),
          ),
        const IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black54,
                  Colors.transparent,
                  Colors.transparent,
                  Colors.black87,
                ],
                stops: [0, 0.22, 0.45, 1],
              ),
            ),
          ),
        ),
        Positioned(
          right: 4,
          bottom: 100,
          child: Column(
            children: [
              _button(
                '$_likes likes',
                _liked ? Icons.favorite : Icons.favorite_border,
                _like,
                color: _liked ? Colors.pinkAccent : null,
              ),
              _button('Comments', Icons.chat_bubble_outline, _commentSheet),
              _button(
                'Share',
                Icons.share,
                () => _action(() async {
                  await SharePlus.instance.share(
                    ShareParams(
                      text:
                          '${widget.video['caption'] ?? widget.video['title']}\n$apiBase/share/video/$_id',
                    ),
                  );
                }, signIn: false),
              ),
              _button(
                _saved ? 'Saved' : 'Save',
                _saved ? Icons.bookmark : Icons.bookmark_outline,
                _save,
              ),
              _button('Report', Icons.flag_outlined, _report),
            ],
          ),
        ),
        Positioned(
          left: 14,
          right: 80,
          bottom: 46,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 17,
                    backgroundImage:
                        (creator?['profilePhotoUrl'] ?? '').toString().isEmpty
                        ? null
                        : NetworkImage(
                            assetUrl('${creator!['profilePhotoUrl']}'),
                          ),
                    child:
                        (creator?['profilePhotoUrl'] ?? '').toString().isEmpty
                        ? const Icon(Icons.person)
                        : null,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '@${creator?['username'] ?? 'zindaplay'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
              if (creator != null && !_self)
                TextButton(
                  onPressed: _busy ? null : _follow,
                  child: Text(
                    _following ? 'Following' : 'Follow',
                    style: const TextStyle(color: Color(0xFFD6C8FF)),
                  ),
                ),
              Text(
                '${widget.video['caption'] ?? widget.video['description'] ?? ''}',
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              Text(
                (widget.video['hashtags'] as List? ?? [])
                    .map((tag) => '#$tag')
                    .join(' '),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xFFD6C8FF)),
              ),
              Text('$_views views', style: const TextStyle(fontSize: 12)),
              if (_error != null)
                Text(
                  _error!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.orangeAccent),
                ),
            ],
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Column(
            children: [
              Row(
                children: [
                  IconButton(
                    tooltip: _paused ? 'Play' : 'Pause',
                    onPressed: () {
                      setState(() => _paused = !_paused);
                      _sync();
                    },
                    icon: Icon(_paused ? Icons.play_arrow : Icons.pause),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: widget.muted ? 'Unmute' : 'Mute',
                    onPressed: widget.onMute,
                    icon: Icon(
                      widget.muted ? Icons.volume_off : Icons.volume_up,
                    ),
                  ),
                ],
              ),
              if (controller != null && controller.value.isInitialized)
                VideoProgressIndicator(
                  controller,
                  allowScrubbing: true,
                  colors: const VideoProgressColors(
                    playedColor: Color(0xFF8B5CF6),
                    bufferedColor: Colors.white24,
                    backgroundColor: Colors.black,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
