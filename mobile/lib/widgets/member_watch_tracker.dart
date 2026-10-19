import 'dart:async';

import 'package:flutter/material.dart';
import 'package:visibility_detector/visibility_detector.dart';

import '../api.dart';

class MemberWatchTracker extends StatefulWidget {
  final String videoId;
  final Widget child;
  final ValueChanged<String> onError;

  const MemberWatchTracker({
    super.key,
    required this.videoId,
    required this.child,
    required this.onError,
  });

  @override
  State<MemberWatchTracker> createState() => _MemberWatchTrackerState();
}

class _MemberWatchTrackerState extends State<MemberWatchTracker>
    with WidgetsBindingObserver {
  final _visibilityKey = UniqueKey();
  Timer? _timer;
  bool _visible = false;
  bool _foreground = true;
  int _activeSeconds = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _foreground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _start();
  }

  Future<void> _start() async {
    final api = Api.instance;
    if (!api.signedIn ||
        !['member', 'creator', 'promoter'].contains(api.role)) {
      return;
    }
    final token = api.token;
    try {
      final session = await api.post(
        '/videos/${Uri.encodeComponent(widget.videoId)}/watch-start',
      ) as Map;
      if (!mounted || api.token != token) return;
      final watchId = session['watchId'];
      final requiredSeconds = session['requiredWatchSeconds'];
      if (watchId is! String ||
          watchId.isEmpty ||
          requiredSeconds is! int ||
          requiredSeconds < 1) {
        throw ApiException('The server returned an invalid watch session.');
      }
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) async {
        if (api.token != token) {
          timer.cancel();
          return;
        }
        if (!_visible ||
            !_foreground ||
            ModalRoute.of(context)?.isCurrent != true) {
          return;
        }
        _activeSeconds++;
        if (_activeSeconds < requiredSeconds) return;
        timer.cancel();
        try {
          await api.post(
            '/videos/${Uri.encodeComponent(widget.videoId)}/watch-complete',
            {'watchId': watchId, 'activeSeconds': _activeSeconds},
          );
        } catch (error) {
          if (mounted) {
            widget.onError('Could not record member watch rewards: $error');
          }
        }
      });
    } catch (error) {
      if (mounted) {
        widget.onError('Could not start member watch rewards: $error');
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => VisibilityDetector(
    key: _visibilityKey,
    onVisibilityChanged: (info) => _visible = info.visibleFraction >= .5,
    child: widget.child,
  );
}
