import 'package:flutter/material.dart';

import '../api.dart';
import '../screens/auth_screen.dart';

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
        await Navigator.push(
          context,
          MaterialPageRoute<void>(builder: (_) => const AuthScreen()),
        );
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
    child: SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.65,
      child: Column(
        children: [
          ListTile(title: Text('Comments ($_commentCount)')),
          Expanded(
            child: _comments.isEmpty
                ? const Center(child: Text('Be the first to comment.'))
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
                    decoration: const InputDecoration(
                      hintText: 'Add a comment',
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
        ],
      ),
    ),
  );
}
