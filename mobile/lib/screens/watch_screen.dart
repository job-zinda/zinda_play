import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import '../public_links.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../ads.dart';
import '../api.dart';
import 'auth_screen.dart';
import 'shorts_screen.dart';

class WatchScreen extends StatefulWidget {
  final Map<String, dynamic> video;
  const WatchScreen({super.key, required this.video});
  @override
  State<WatchScreen> createState() => _WatchScreenState();
}

class _WatchScreenState extends State<WatchScreen> {
  WebViewController? _web;
  bool _liked = false;
  int _likes = 0;
  int _commentCount = 0;
  List<Map<String, dynamic>> _comments = [];
  final _comment = TextEditingController();
  String? _error;

  String get _id => '${widget.video['id']}';

  @override
  void initState() {
    super.initState();
    if (widget.video['videoType'] == 'short') return;
    Interests.record(widget.video['categoryId']);
    final url = widget.video['playbackUrl'] as String?;
    if (url != null && url.isNotEmpty) {
      final controller = WebViewController();
      if (!kIsWeb) {
        controller
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(Colors.black);
      }
      _web = controller..loadRequest(Uri.parse(url));
    }
    _loadInteractions();
    _countView();
  }

  Future<void> _countView() async {
    try {
      await Api.instance.post('/videos/$_id/view');
    } catch (_) {}
  }

  Future<void> _loadInteractions() async {
    try {
      final data = await Api.instance.get('/videos/$_id/interactions') as Map;
      if (!mounted) return;
      setState(() {
        _liked = data['liked'] == true;
        _likes = (data['likeCount'] as num?)?.toInt() ?? 0;
        _comments = (data['comments'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _commentCount =
            (data['commentCount'] as num?)?.toInt() ?? _comments.length;
      });
    } catch (_) {}
  }

  Future<bool> _requireSignIn() async {
    if (Api.instance.signedIn) return true;
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const AuthScreen()),
    );
    return Api.instance.signedIn;
  }

  Future<void> _like() async {
    if (!await _requireSignIn()) return;
    try {
      final data = await Api.instance.post('/videos/$_id/like') as Map;
      setState(() {
        _liked = data['liked'] == true;
        _likes = (data['likeCount'] as num?)?.toInt() ?? _likes;
      });
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  Future<void> _postComment() async {
    final text = _comment.text.trim();
    if (text.isEmpty || !await _requireSignIn()) return;
    try {
      await Api.instance.post('/videos/$_id/comments', {'text': text});
      _comment.clear();
      await _loadInteractions();
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.video;
    if (v['videoType'] == 'short') {
      return Scaffold(
        appBar: AppBar(title: const Text('Simply')),
        body: ShortsScreen(initialVideo: v),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${v['title'] ?? ''}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: ListView(
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: _web == null
                ? const Center(child: Text('Video is not available yet.'))
                : PlayerGate(builder: (_) => WebViewWidget(controller: _web!)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Row(
              children: [
                const Icon(
                  Icons.remove_red_eye_outlined,
                  size: 14,
                  color: Colors.white70,
                ),
                const SizedBox(width: 4),
                Text(
                  '${v['views'] ?? 0} views',
                  style: const TextStyle(fontSize: 12, color: Colors.white70),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              '${v['title'] ?? ''}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
          ),
          Row(
            children: [
              const SizedBox(width: 8),
              TextButton.icon(
                onPressed: _like,
                icon: Icon(
                  _liked ? Icons.favorite : Icons.favorite_border,
                  color: _liked ? Colors.redAccent : null,
                ),
                label: Text('$_likes'),
              ),
              TextButton.icon(
                onPressed: () => sharePublicLink(context,
                  '${v['title']} - watch on Zinda Play', videoShareUrl(_id)),
                icon: const Icon(Icons.share),
                label: const Text('Share'),
              ),
            ],
          ),
          if ((v['description'] ?? '').toString().isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text('${v['description']}'),
            ),
          const Divider(height: 32),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              'Comments ($_commentCount)',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _comment,
                    maxLength: 500,
                    decoration: const InputDecoration(
                      hintText: 'Add a comment',
                      counterText: '',
                    ),
                  ),
                ),
                IconButton(
                  onPressed: _postComment,
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.redAccent),
              ),
            ),
          for (final c in _comments)
            ListTile(
              dense: true,
              title: Text(
                '${c['username'] ?? ''}',
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
              subtitle: Text(
                '${c['text'] ?? ''}',
                style: const TextStyle(color: Colors.white),
              ),
            ),
        ],
      ),
    );
  }
}
