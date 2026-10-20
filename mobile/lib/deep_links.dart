import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import 'api.dart';
import 'screens/auth_screen.dart';
import 'screens/creator_screen.dart';
import 'screens/watch_screen.dart';

final appNavigatorKey = GlobalKey<NavigatorState>();

enum DeepLinkKind { video, creator, referral }

class DeepLink {
  final DeepLinkKind kind;
  final String id;
  const DeepLink(this.kind, this.id);

  @override
  bool operator ==(Object other) =>
      other is DeepLink && other.kind == kind && other.id == id;

  @override
  int get hashCode => Object.hash(kind, id);
}

const _hosts = {'zindaplay.com', 'www.zindaplay.com'};
// zindaplay:// is used by share pages to open the installed app even before Android verifies https links.
const _schemes = {'https', 'zindaplay'};
final _referralCode = RegExp(r'^[1-9]\d{5}$');

/// Maps zindaplay.com share and invitation links (and the `?video=`, `?short=`,
/// `?creator=`, `?ref=` pages they redirect to) to in-app destinations.
DeepLink? parseDeepLink(Uri uri) {
  if (!_schemes.contains(uri.scheme.toLowerCase()) ||
      !_hosts.contains(uri.host.toLowerCase())) {
    return null;
  }
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.length == 2 &&
      segments[0] == 'join' &&
      _referralCode.hasMatch(segments[1])) {
    return DeepLink(DeepLinkKind.referral, segments[1]);
  }
  if (segments.length == 3 &&
      segments[0] == 'share' &&
      segments[2].trim().isNotEmpty) {
    if (segments[1] == 'video') {
      return DeepLink(DeepLinkKind.video, segments[2]);
    }
    if (segments[1] == 'creator') {
      return DeepLink(DeepLinkKind.creator, segments[2]);
    }
  }
  final query = uri.queryParameters;
  final video = query['video'] ?? query['short'];
  if (video != null && video.trim().isNotEmpty) {
    return DeepLink(DeepLinkKind.video, video);
  }
  final creator = query['creator'];
  if (creator != null && creator.trim().isNotEmpty) {
    return DeepLink(DeepLinkKind.creator, creator);
  }
  final ref = query['ref'];
  if (ref != null && _referralCode.hasMatch(ref)) {
    return DeepLink(DeepLinkKind.referral, ref);
  }
  return null;
}

class DeepLinkListener extends StatefulWidget {
  final Widget child;
  final Stream<Uri>? links;
  const DeepLinkListener({super.key, required this.child, this.links});

  @override
  State<DeepLinkListener> createState() => _DeepLinkListenerState();
}

class _DeepLinkListenerState extends State<DeepLinkListener> {
  StreamSubscription<Uri>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = (widget.links ?? AppLinks().uriLinkStream).listen(
      _open,
      onError: (_) {},
    );
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  Future<void> _open(Uri uri) async {
    final link = parseDeepLink(uri);
    if (link == null) return;
    if (link.kind == DeepLinkKind.referral) {
      _openReferral(link.id);
      return;
    }
    final id = Uri.encodeComponent(link.id);
    try {
      final data = await Api.instance.get(
        link.kind == DeepLinkKind.video
            ? '/videos/$id'
            : '/creators/$id/profile',
      );
      final item = Map<String, dynamic>.from(data as Map);
      final navigator = appNavigatorKey.currentState;
      if (navigator == null) return;
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => link.kind == DeepLinkKind.video
              ? WatchScreen(video: item)
              : CreatorScreen(creator: item),
        ),
      );
    } catch (_) {
      final context = appNavigatorKey.currentContext;
      if (context == null || !context.mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(
            link.kind == DeepLinkKind.video
                ? 'This shared video is no longer available.'
                : 'This creator profile is no longer available.',
          ),
        ),
      );
    }
  }

  void _openReferral(String code) {
    final navigator = appNavigatorKey.currentState;
    if (navigator == null) return;
    if (Api.instance.signedIn) {
      ScaffoldMessenger.maybeOf(navigator.context)?.showSnackBar(
        const SnackBar(
          content: Text(
            'You are already signed in. Invitation IDs apply when creating a new account.',
          ),
        ),
      );
      return;
    }
    navigator.push(
      MaterialPageRoute<void>(builder: (_) => AuthScreen(referralCode: code)),
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
