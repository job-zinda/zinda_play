import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../ads.dart';
import '../engagement.dart';
import '../api.dart';
import '../playback.dart';
import 'auth_screen.dart';
import 'shorts_screen.dart';
import '../widgets/share_sheet.dart';
import '../widgets/member_watch_tracker.dart';
import '../widgets/normal_video_player.dart';
import '../widgets/video_engagement.dart';
import '../widgets/comment_threads.dart';
import '../theme.dart';

class WatchScreen extends StatefulWidget {
  final Map<String, dynamic> video;
  const WatchScreen({super.key, required this.video});
  @override
  State<WatchScreen> createState() => _WatchScreenState();
}

class _WatchScreenState extends State<WatchScreen> {
  WebViewController? _web;
  bool _liked = false;
  String? _reaction;
  Map<String, dynamic>? _reactions;
  String? _commentsNextCursor;
  int _likes = 0;
  int _commentCount = 0;
  List<Map<String, dynamic>> _comments = [];
  final _comment = TextEditingController();
  final _commentFocus = FocusNode();
  final _commentsKey = GlobalKey();
  // Keep bookmarks separate from authentication storage, which logout clears.
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      storageNamespace: 'zinda_video_bookmarks',
      resetOnError: false,
    ),
    iOptions: IOSOptions(accountName: 'zinda_video_bookmarks'),
  );
  bool _loading = true;
  bool _interactionsLoaded = false;
  bool _liking = false;
  bool _posting = false;
  bool _saving = false;
  bool _saved = false;
  String? _interactionError;
  String? _error;

  String get _id => '${widget.video['id']}';

  @override
  void initState() {
    super.initState();
    if (widget.video['videoType'] == 'short') return;
    Interests.record(widget.video['categoryId']);
    final url = widget.video['playbackUrl'] as String?;
    if (url != null && url.isNotEmpty && !isDirectPlayback(url)) {
      final controller = WebViewController();
      if (!kIsWeb) {
        controller
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(Colors.black);
      }
      _web = controller..loadRequest(Uri.parse(normalPlaybackUrl(url)));
    }
    _loadInteractions();
    _loadSaved();
    _countView();
  }

  Future<void> _countView() async {
    try {
      await Api.instance.post('/videos/$_id/view');
    } catch (_) {}
  }

  Future<void> _loadInteractions() async {
    setState(() => _loading = true);
    try {
      final data = await Api.instance.get('/videos/$_id/interactions') as Map;
      if (!mounted) return;
      setState(() {
        _liked = data['liked'] == true;
        _reaction = data['reaction'] as String?;
        _reactions = data['reactions'] == null
            ? null
            : Map<String, dynamic>.from(data['reactions'] as Map);
        _commentsNextCursor = data['commentsNextCursor'] as String?;
        _likes = (data['likeCount'] as num?)?.toInt() ?? 0;
        _comments = (data['comments'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _commentCount =
            (data['commentCount'] as num?)?.toInt() ?? _comments.length;
        _interactionsLoaded = true;
        _interactionError = null;
      });
    } catch (e) {
      if (mounted) setState(() => _interactionError = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _requireSignIn() async {
    if (Api.instance.signedIn) return true;
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const AuthScreen()),
    );
    if (!mounted) return false;
    setState(() {});
    if (Api.instance.signedIn) {
      await Future.wait([_loadInteractions(), _loadSaved()]);
    }
    return Api.instance.signedIn;
  }

  String? get _saveKey {
    final username = Api.instance.username;
    if (!Api.instance.signedIn || username == null) return null;
    return 'saved-video:${Uri.encodeComponent(username)}:${Uri.encodeComponent(_id)}';
  }

  Future<void> _loadSaved() async {
    final key = _saveKey;
    if (key == null) return;
    setState(() => _saving = true);
    try {
      final saved = await _storage.read(key: key) == 'true';
      if (mounted) setState(() => _saved = saved);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not load saved video: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      if (!await _requireSignIn() || !mounted) return;
      final key = _saveKey;
      if (key == null) {
        throw ApiException('Please sign in again to save this video.');
      }
      final saved = !_saved;
      if (saved) {
        await _storage.write(key: key, value: 'true');
      } else {
        await _storage.delete(key: key);
      }
      if (mounted) setState(() => _saved = saved);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not save video: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _like([String reaction = 'like']) async {
    if (_liking || _loading) return;
    setState(() {
      _liking = true;
      _error = null;
    });
    try {
      if (!await _requireSignIn() || !mounted) return;
      final data = await Api.instance.post('/videos/$_id/reaction', {
        'reaction': reaction,
      }) as Map;
      if (!mounted) return;
      setState(() {
        _liked = data['liked'] == true;
        _reaction = data['reaction'] as String?;
        _reactions = data['reactions'] == null
            ? null
            : Map<String, dynamic>.from(data['reactions'] as Map);
        _likes = (data['likeCount'] as num?)?.toInt() ?? _likes;
      });
      if (_reaction != null) unawaited(playEngagementSound());
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _liking = false);
    }
  }

  Future<void> _postComment() async {
    final text = _comment.text.trim();
    if (_posting || text.isEmpty) return;
    setState(() {
      _posting = true;
      _error = null;
    });
    try {
      if (!await _requireSignIn() || !mounted) return;
      await Api.instance.post('/videos/$_id/comments', {'text': text});
      if (!mounted) return;
      _comment.clear();
      unawaited(playEngagementSound());
      await _loadInteractions();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _openComments() async {
    final target = _commentsKey.currentContext;
    if (target != null) {
      await Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 250),
        alignment: 0,
      );
    }
    if (!mounted) return;
    if (Api.instance.signedIn) _commentFocus.requestFocus();
    if (!_loading && !_liking && !_posting) await _loadInteractions();
  }

  @override
  void dispose() {
    _comment.dispose();
    _commentFocus.dispose();
    super.dispose();
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
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: '${v['playbackUrl'] ?? ''}'.isEmpty
                  ? const Center(child: Text('Video is not available yet.'))
                  : PlayerGate(
                      builder: (_) => MemberWatchTracker(
                        key: ValueKey(Api.instance.token),
                        videoId: _id,
                        onError: (message) {
                          if (mounted) setState(() => _error = message);
                        },
                        child: isDirectPlayback('${v['playbackUrl']}')
                            ? NormalVideoPlayer(source: '${v['playbackUrl']}')
                            : WebViewWidget(controller: _web!),
                      ),
                    ),
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
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 14),
              child: VideoEngagementBar(
                liked: _liked,
                reaction: _reaction,
                reactions: _reactions,
                onReact: _like,
                saved: _saved,
                likes: _likes,
                comments: _commentCount,
                loading: !_interactionsLoaded,
                liking: _liking,
                saving: _saving,
                onLike: _like,
                onComments: _openComments,
                onShare: () => showVideoShareSheet(context, v),
                onSave: _save,
              ),
            ),
            if ((v['description'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text('${v['description']}'),
              ),
            Padding(
              key: _commentsKey,
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
              child: VideoEngagementCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _interactionsLoaded
                                ? 'Comments ($_commentCount)'
                                : 'Comments',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Refresh comments',
                          visualDensity: VisualDensity.compact,
                          onPressed: _loading || _liking || _posting
                              ? null
                              : _loadInteractions,
                          icon: const Icon(
                            Icons.refresh_rounded,
                            size: 20,
                            color: kPurple,
                          ),
                        ),
                      ],
                    ),
                    if (_loading)
                      const Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (_interactionError == null &&
                        _comments.isEmpty &&
                        _commentCount == 0)
                      const VideoCommentsEmptyState(),
                    if (_interactionError != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          'Could not refresh comments and likes: $_interactionError. Tap refresh to retry.',
                          style: const TextStyle(color: Colors.redAccent),
                        ),
                      ),
                    CommentThreads(
                      videoId: _id,
                      comments: _comments,
                      nextCursor: _commentsNextCursor,
                      requireSignIn: _requireSignIn,
                      onAdded: () => setState(() => _commentCount++),
                    ),
                    if (Api.instance.signedIn)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _comment,
                                focusNode: _commentFocus,
                                maxLength: 500,
                                minLines: 1,
                                maxLines: 4,
                                enabled: !_posting,
                                style: const TextStyle(color: Colors.white),
                                decoration: InputDecoration(
                                  hintText: 'Share your thoughts...',
                                  hintStyle: const TextStyle(
                                    color: kMuted,
                                    fontSize: 13,
                                  ),
                                  counterText: '',
                                  filled: true,
                                  fillColor: const Color(0xFF211C32),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(16),
                                    borderSide: BorderSide.none,
                                  ),
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: 'Post comment',
                              enableFeedback: false,
                              onPressed: _posting ? null : _postComment,
                              icon: _posting
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.send_rounded,
                                      color: kPurple,
                                      size: 22,
                                    ),
                            ),
                          ],
                        ),
                      )
                    else
                      Container(
                        margin: const EdgeInsets.only(top: 4),
                        padding: const EdgeInsets.only(top: 14),
                        decoration: const BoxDecoration(
                          border: Border(
                            top: BorderSide(color: Color(0x664E3B82)),
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.person_outline_rounded,
                              color: kPurple,
                              size: 24,
                            ),
                            const SizedBox(width: 10),
                            const Expanded(
                              child: Text(
                                'Sign in to like, comment or save.',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFFB2ADCE),
                                  height: 1.4,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            GradientButton(
                              onPressed: _requireSignIn,
                              radius: 13,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 12,
                              ),
                              child: const Text(
                                'Sign In',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Colors.redAccent),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
