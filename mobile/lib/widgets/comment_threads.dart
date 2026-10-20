import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../engagement.dart';
import 'reaction_button.dart';

class CommentThreads extends StatefulWidget {
  final String videoId;
  final List<Map<String, dynamic>> comments;
  final String? nextCursor;
  final Future<bool> Function() requireSignIn;
  final VoidCallback onAdded;

  const CommentThreads({
    super.key,
    required this.videoId,
    required this.comments,
    required this.requireSignIn,
    required this.onAdded,
    this.nextCursor,
  });

  @override
  State<CommentThreads> createState() => _CommentThreadsState();
}

class _CommentThreadsState extends State<CommentThreads> {
  final _extra = <Map<String, dynamic>>[];
  late String? _next = widget.nextCursor;
  bool _loading = false;
  String? _error;

  @override
  void didUpdateWidget(CommentThreads oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.comments != widget.comments ||
        oldWidget.nextCursor != widget.nextCursor) {
      _extra.clear();
      _next = widget.nextCursor;
    }
  }

  Future<void> _load() async {
    if (_loading || _next == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await Api.instance.get(
        '/videos/${widget.videoId}/comments?before=$_next',
      ) as Map;
      if (!mounted) return;
      setState(() {
        _extra.addAll(
          (page['comments'] as List).map(
            (row) => Map<String, dynamic>.from(row as Map),
          ),
        );
        _next = page['nextCursor'] as String?;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final unique = <String, Map<String, dynamic>>{};
    for (final comment in [...widget.comments, ..._extra]) {
      unique['${comment['id'] ?? unique.length}'] = comment;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in unique.entries)
          _CommentThread(
            key: ValueKey('${Api.instance.token}:${entry.key}'),
            videoId: widget.videoId,
            comment: entry.value,
            requireSignIn: widget.requireSignIn,
            onAdded: widget.onAdded,
          ),
        if (_next != null)
          TextButton(
            onPressed: _loading ? null : _load,
            child: Text(_loading ? 'Loading...' : 'Load more comments'),
          ),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
      ],
    );
  }
}

class _CommentThread extends StatefulWidget {
  final String videoId;
  final Map<String, dynamic> comment;
  final Future<bool> Function() requireSignIn;
  final VoidCallback onAdded;
  final int depth;

  const _CommentThread({
    super.key,
    required this.videoId,
    required this.comment,
    required this.requireSignIn,
    required this.onAdded,
    this.depth = 0,
  });

  @override
  State<_CommentThread> createState() => _CommentThreadState();
}

class _CommentThreadState extends State<_CommentThread> {
  late Map<String, dynamic> _comment = Map.of(widget.comment);
  final _text = TextEditingController();
  final _replies = <Map<String, dynamic>>[];
  bool _loaded = false;
  bool _open = false;
  bool _replying = false;
  bool _busy = false;
  String? _next;
  String? _error;
  String get _path => '/videos/${widget.videoId}/comments';
  int get _replyCount => (_comment['replyCount'] as num?)?.toInt() ?? 0;

  @override
  void didUpdateWidget(_CommentThread oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.comment != widget.comment) _comment = Map.of(widget.comment);
  }

  Future<void> _work(
    Future<void> Function() action, {
    bool signIn = false,
  }) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (signIn && !await widget.requireSignIn()) return;
      if (!mounted) return;
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _load() async {
    final page = await Api.instance.get(
      '$_path?parentId=${_comment['id']}${_loaded && _next != null ? '&before=$_next' : ''}',
    ) as Map;
    if (!mounted) return;
    setState(() {
      final existing = _replies.map((row) => '${row['id']}').toSet();
      _replies.addAll(
        (page['comments'] as List)
            .map((row) => Map<String, dynamic>.from(row as Map))
            .where((row) => existing.add('${row['id']}')),
      );
      _loaded = true;
      _next = page['nextCursor'] as String?;
      _open = true;
    });
  }

  Future<void> _react(String type) => _work(() async {
    final result = await Api.instance.post(
      '$_path/${_comment['id']}/reaction',
      {'reaction': type},
    ) as Map;
    if (!mounted) return;
    setState(() => _comment.addAll(Map<String, dynamic>.from(result)));
    if (result['reaction'] != null) unawaited(playEngagementSound());
  }, signIn: true);

  Future<void> _send() => _work(() async {
    final result = await Api.instance.post(_path, {
      'text': _text.text.trim(),
      'parentId': _comment['id'],
    }) as Map;
    if (!mounted) return;
    setState(() {
      _replies.insert(0, Map<String, dynamic>.from(result));
      _comment['replyCount'] = _replyCount + 1;
      _text.clear();
      _replying = false;
      _open = true;
    });
    unawaited(playEngagementSound());
    widget.onAdded();
  }, signIn: true);

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${_comment['username'] ?? ''}',
          style: const TextStyle(
            color: Color(0xFFD8B4FE),
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text('${_comment['text'] ?? ''}'),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 6,
          children: [
            ReactionButton(
              inline: true,
              reaction: _comment['reaction'] as String?,
              count: (_comment['reactionCount'] as num?)?.toInt() ?? 0,
              counts: _comment['reactions'] == null
                  ? null
                  : Map<String, dynamic>.from(_comment['reactions'] as Map),
              busy: _busy,
              onReact: _react,
            ),
            TextButton(
              style: const ButtonStyle(enableFeedback: false),
              onPressed: _busy
                  ? null
                  : () => _work(() async {
                      setState(() => _replying = !_replying);
                    }, signIn: true),
              child: const Text('Reply'),
            ),
            if (_replyCount > 0 || _replies.isNotEmpty)
              TextButton(
                style: const ButtonStyle(enableFeedback: false),
                onPressed: _busy
                    ? null
                    : () {
                        if (_open) {
                          setState(() => _open = false);
                        } else if (_loaded) {
                          setState(() => _open = true);
                        } else {
                          _work(_load);
                        }
                      },
                child: Text(
                  _open ? 'Hide replies' : 'Show replies ($_replyCount)',
                ),
              ),
          ],
        ),
        if (_replying) ...[
          TextField(
            controller: _text,
            autofocus: true,
            enabled: !_busy,
            maxLength: 1000,
            minLines: 1,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: 'Reply to ${_comment['username']}',
            ),
            onChanged: (_) => setState(() {}),
          ),
          Wrap(
            children: [
              TextButton(
                style: const ButtonStyle(enableFeedback: false),
                onPressed: _busy || _text.text.trim().isEmpty ? null : _send,
                child: const Text('Send reply'),
              ),
              TextButton(
                onPressed: _busy
                    ? null
                    : () => setState(() => _replying = false),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ],
        if (_error != null)
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
        if (_open)
          Padding(
            padding: EdgeInsets.only(left: widget.depth < 3 ? 12 : 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final reply in _replies)
                  _CommentThread(
                    key: ValueKey('${reply['id']}'),
                    videoId: widget.videoId,
                    comment: reply,
                    requireSignIn: widget.requireSignIn,
                    onAdded: widget.onAdded,
                    depth: widget.depth + 1,
                  ),
                if (!_loaded || _next != null)
                  TextButton(
                    onPressed: _busy ? null : () => _work(_load),
                    child: Text(_busy ? 'Loading...' : 'Load more replies'),
                  ),
              ],
            ),
          ),
      ],
    ),
  );
}
