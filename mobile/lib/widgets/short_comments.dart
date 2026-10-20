import 'package:flutter/material.dart';

import '../api.dart';
import '../screens/auth_screen.dart';
import '../widgets/video_engagement.dart';
import '../theme.dart';

class ShortComments extends StatefulWidget {
  final String id;
  final List<Map<String, dynamic>> comments;
  final int commentCount;
  const ShortComments({
    super.key,
    required this.id,
    required this.comments,
    required this.commentCount,
  });
  @override
  State<ShortComments> createState() => _ShortCommentsState();
}

class _ShortCommentsState extends State<ShortComments> {
  final _text = TextEditingController();
  late final _comments = List<Map<String, dynamic>>.of(widget.comments);
  late int _commentCount = widget.commentCount;
  bool _sending = false;
  String? _error;

  Future<void> _signIn() async {
    await Navigator.push(
      context,
      MaterialPageRoute<void>(builder: (_) => const AuthScreen()),
    );
    if (mounted) setState(() {});
  }

  Future<void> _send() async {
    if (_sending) return;
    final text = _text.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'Type a comment before sending.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      if (!Api.instance.signedIn) {
        await _signIn();
        if (!mounted || !Api.instance.signedIn) return;
      }
      final result = await Api.instance.post('/videos/${widget.id}/comments', {
        'text': text,
      }) as Map;
      if (!mounted) return;
      setState(() {
        _comments.insert(0, Map<String, dynamic>.from(result));
        _commentCount++;
        _text.clear();
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        border: Border(top: BorderSide(color: Color(0x994E3B82))),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF19162D), Color(0xFF0F101D)],
        ),
      ),
      height: MediaQuery.sizeOf(context).height * 0.65,
      child: Column(
        children: [
          ListTile(
            contentPadding: const EdgeInsets.only(left: 4),
            title: Text(
              'Comments ($_commentCount)',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            trailing: IconButton(
              tooltip: 'Close comments',
              onPressed: _sending ? null : () => Navigator.pop(context),
              icon: const Icon(Icons.close_rounded, color: kPurple),
            ),
          ),
          Expanded(
            child: _comments.isEmpty
                ? const SingleChildScrollView(child: VideoCommentsEmptyState())
                : ListView(
                    children: [
                      for (final comment in _comments)
                        ListTile(
                          title: Text('${comment['username']}'),
                          subtitle: Text('${comment['text']}'),
                        ),
                    ],
                  ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                _error!,
                semanticsLabel: 'Comment could not be sent: $_error',
                style: const TextStyle(color: Colors.redAccent),
              ),
            ),
          if (Api.instance.signedIn)
            Row(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: TextField(
                      controller: _text,
                      enabled: !_sending,
                      maxLength: 500,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        hintText: 'Share your thoughts...',
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
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: Tooltip(
                    message: 'Post comment',
                    child: FilledButton(
                      onPressed: _sending ? null : _send,
                      child: Text(_sending ? 'Sending...' : 'Send'),
                    ),
                  ),
                ),
              ],
            ),
          if (!Api.instance.signedIn)
            Container(
              padding: const EdgeInsets.only(top: 14),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: Color(0x664E3B82))),
              ),
              child: Row(
                children: [
                  const Icon(Icons.person_outline_rounded, color: kPurple),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Sign in to like, comment or follow creators.',
                      style: TextStyle(fontSize: 12, color: Color(0xFFB2ADCE)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GradientButton(
                    onPressed: _signIn,
                    radius: 13,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    child: const Text(
                      'Sign In',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    ),
  );
}
