import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import 'creator_screen.dart';

class CreatorSearchScreen extends StatefulWidget {
  const CreatorSearchScreen({super.key});

  @override
  State<CreatorSearchScreen> createState() => _CreatorSearchScreenState();
}

class _CreatorSearchScreenState extends State<CreatorSearchScreen> {
  final _query = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  String? _error;
  int _request = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _changed(String value) {
    _debounce?.cancel();
    setState(() {});
    if (value.trim().length < 2) {
      _request++;
      setState(() {
        _results = [];
        _loading = false;
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), _search);
  }

  Future<void> _search() async {
    final term = _query.text.trim();
    if (term.length < 2) return;
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await Api.instance.get(
        '/discover/creators?search=${Uri.encodeQueryComponent(term)}',
      );
      if (!mounted || request != _request) return;
      setState(() {
        _results = (data as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _loading = false;
      });
    } catch (error) {
      if (!mounted || request != _request) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final term = _query.text.trim();
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          controller: _query,
          autofocus: true,
          textInputAction: TextInputAction.search,
          onChanged: _changed,
          onSubmitted: (_) => _search(),
          decoration: InputDecoration(
            hintText: 'Search content creators',
            border: InputBorder.none,
            suffixIcon: _query.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear',
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _query.clear();
                      _changed('');
                    },
                  ),
          ),
        ),
      ),
      body: term.length < 2
          ? const _Message('Type at least 2 letters of a creator name.')
          : _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? _Message('Couldn\'t search creators. $_error')
          : _results.isEmpty
          ? _Message('No creators match "$term".')
          : ListView.separated(
              itemCount: _results.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final c = _results[i];
                final photo = assetUrl('${c['profilePhotoUrl'] ?? ''}');
                final followers = c['followerCount'];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: kPanel,
                    backgroundImage: photo.isEmpty ? null : NetworkImage(photo),
                    child: photo.isEmpty ? const Icon(Icons.person) : null,
                  ),
                  title: Text('${c['displayName'] ?? c['username']}'),
                  subtitle: Text(
                    '@${c['username']}'
                    '${followers is num ? ' · $followers followers' : ''}',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => CreatorScreen(creator: c),
                    ),
                  ),
                );
              },
            ),
    );
  }
}

class _Message extends StatelessWidget {
  final String text;
  const _Message(this.text);

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(color: kMuted),
      ),
    ),
  );
}
