import 'package:flutter/material.dart';

import '../api.dart';
import '../intro_video.dart';
import '../widgets/video_card.dart';
import 'auth_screen.dart';
import 'watch_screen.dart';

class CreatorScreen extends StatefulWidget {
  final Map<String, dynamic> creator;
  const CreatorScreen({super.key, required this.creator});
  @override
  State<CreatorScreen> createState() => _CreatorScreenState();
}

class _CreatorScreenState extends State<CreatorScreen> {
  bool _following = false;
  bool _isSelf = false;
  int _followers = 0;
  String _introUrl = '';
  List<Map<String, dynamic>> _videos = [];
  String? _error;

  String get _id => '${widget.creator['id']}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final profile = await Api.instance.get('/creators/$_id/profile') as Map;
      if (!mounted) return;
      setState(() {
        _following = profile['following'] == true;
        _isSelf = profile['isSelf'] == true;
        _introUrl = '${profile['introVideoUrl'] ?? ''}';
        _followers = (profile['followerCount'] as num?)?.toInt() ?? 0;
        final list = profile['videos'];
        _videos = list is List ? list.map((e) => Map<String, dynamic>.from(e as Map)).toList() : [];
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _toggleFollow() async {
    if (!Api.instance.signedIn) {
      await Navigator.push(context, MaterialPageRoute(builder: (_) => const AuthScreen()));
      if (!Api.instance.signedIn) return;
    }
    try {
      final data = (_following ? await Api.instance.delete('/creators/$_id/follow') : await Api.instance.post('/creators/$_id/follow')) as Map;
      setState(() {
        _following = data['following'] == true;
        _followers = (data['followerCount'] as num?)?.toInt() ?? _followers;
      });
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.creator;
    final photo = assetUrl(c['profilePhotoUrl'] as String?);
    return Scaffold(
      appBar: AppBar(title: Text('${c['displayName'] ?? c['username']}')),
      body: ListView(children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            CircleAvatar(radius: 32, backgroundImage: photo.isEmpty ? null : NetworkImage(photo), child: photo.isEmpty ? const Icon(Icons.person, size: 32) : null),
            const SizedBox(width: 16),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${c['displayName'] ?? c['username']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                Text('$_followers followers', style: const TextStyle(color: Colors.white70)),
              ]),
            ),
            if (!_isSelf) FilledButton(onPressed: _toggleFollow, child: Text(_following ? 'Following' : 'Follow')),
          ]),
        ),
        if ((c['bio'] ?? '').toString().isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('${c['bio']}')),
        if (_introUrl.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: IntroVideoPlayer(url: _introUrl)),
        if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))),
        const SizedBox(height: 12),
        for (final v in _videos)
          VideoCard(video: v, onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => WatchScreen(video: v)))),
      ]),
    );
  }
}
