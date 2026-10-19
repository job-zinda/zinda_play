import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import 'business_ads_screen.dart';
import 'account_screen.dart';

class BusinessScreen extends StatefulWidget {
  const BusinessScreen({super.key});
  @override
  State<BusinessScreen> createState() => _BusinessScreenState();
}

class _BusinessScreenState extends State<BusinessScreen> {
  final _api = Api.instance;
  Timer? _poll;
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _videos = [], _creators = [], _requests = [];
  bool _loading = true;
  String? _error, _message;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _refreshProcessing());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Map<String, dynamic> _map(dynamic v) => Map<String, dynamic>.from(v as Map);
  List<Map<String, dynamic>> _list(dynamic v) => (v as List).map(_map).toList();

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        _api.get('/business/profile'),
        _api.get('/business/videos'),
        _api.get('/business/creators'),
        _api.get('/business/creator-requests'),
      ]);
      if (!mounted) return;
      setState(() {
        _profile = _map(r[0]);
        _videos = _list(r[1]);
        _creators = _list(r[2]);
        _requests = _list(r[3]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _loading = false; });
    }
  }

  Future<void> _refreshProcessing() async {
    if (!mounted || !_videos.any((v) => v['processingStatus'] != null && v['processingStatus'] != 'ready' && v['processingStatus'] != 'error')) return;
    try {
      await _api.get('/business/videos/processing');
      final list = await _api.get('/business/videos');
      if (mounted) setState(() => _videos = _list(list));
    } catch (_) {}
  }

  Future<void> _editProfile() async {
    final name = TextEditingController(text: '${_profile?['businessName'] ?? ''}');
    final about = TextEditingController(text: '${_profile?['businessAbout'] ?? ''}');
    final save = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit business'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, maxLength: 100, decoration: const InputDecoration(labelText: 'Business name')),
          TextField(controller: about, maxLength: 1000, maxLines: 3, decoration: const InputDecoration(labelText: 'About')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (save != true) return;
    try {
      await _api.patch('/business/profile', {'businessName': name.text.trim(), 'businessAbout': about.text.trim()});
      await _load();
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  Future<void> _pickLogo() async {
    final picked = await FilePicker.pickFile(type: FileType.image);
    final path = picked?.path;
    if (path == null) return;
    const types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif'};
    final type = types[path.split('.').last.toLowerCase()];
    if (type == null) {
      setState(() => _error = 'Choose a JPEG, PNG, WebP, or GIF logo.');
      return;
    }
    try {
      await _api.uploadFile('PUT', '/business/logo', File(path), type);
      await _load();
    } catch (e) {
      setState(() => _error = '$e');
    }
  }


  Future<void> _requestCreator(Map<String, dynamic> creator) async {
    final note = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Select ${creator['displayName']}'),
        content: TextField(controller: note, maxLength: 1000, maxLines: 4, decoration: const InputDecoration(labelText: 'What do you need?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send to admin')),
        ],
      ),
    );
    if (go != true) return;
    try {
      await _api.post('/business/creator-requests', {'creatorId': creator['id'], 'note': note.text.trim()});
      _message = 'Request sent. The admin will follow up.';
      await _load();
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Business dashboard'),
          actions: [
            IconButton(tooltip: 'Profile & account settings', icon: const Icon(Icons.manage_accounts_outlined),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AccountScreen()))),
          ],
          bottom: const TabBar(tabs: [Tab(text: 'Ads'), Tab(text: 'Creators'), Tab(text: 'Requests')]),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(children: [
                if (_error != null) Card(color: Colors.red.withValues(alpha: 0.18), child: Padding(padding: const EdgeInsets.all(12), child: Text(_error!))),
                if (_message != null) Card(color: Colors.green.withValues(alpha: 0.18), child: Padding(padding: const EdgeInsets.all(12), child: Text(_message!))),
                Expanded(child: TabBarView(children: [_videosTab(), _creatorsTab(), _requestsTab()])),
              ]),
      ),
    );
  }

  Widget _videosTab() {
    final logo = assetUrl('${_profile?['logoUrl'] ?? ''}');
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Card(
          child: ListTile(
            leading: CircleAvatar(backgroundImage: logo.isEmpty ? null : NetworkImage(logo), child: logo.isEmpty ? const Icon(Icons.business) : null),
            title: Text('${_profile?['businessName']}'),
            subtitle: Text('${_profile?['businessAbout'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(onPressed: _pickLogo, icon: const Icon(Icons.image)),
              IconButton(onPressed: _editProfile, icon: const Icon(Icons.edit)),
            ]),
          ),
        ),
        FilledButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => const BusinessAdsScreen())), icon: const Icon(Icons.campaign), label: const Text('Create ads, resubmit & view analytics')),
        const SizedBox(height: 8),
        if (_videos.isNotEmpty) const Text('Legacy video campaigns'),
        for (final v in _videos) _videoTile(v),
      ]),
    );
  }

  Widget _videoTile(Map<String, dynamic> v) {
    final campaign = v['campaign'] as Map<String, dynamic>?;
    final processing = '${v['processingStatus'] ?? 'ready'}';
    final status = processing != 'ready'
        ? '$processing · ${v['encodeProgress'] ?? 0}%'
        : campaign != null && campaign['status'] == 'active'
            ? 'Live · ${campaign['impressions']}/${campaign['targetImpressions']} impressions'
            : v['approvalStatus'] == 'approved' ? 'Approved' : 'Awaiting approval';
    return Card(
      child: ListTile(
        title: Text('${v['title']}', maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(status),
      ),
    );
  }

  Widget _creatorsTab() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(children: [
        for (final c in _creators)
          ListTile(
            leading: CircleAvatar(
              backgroundImage: '${c['profilePhotoUrl']}'.isEmpty ? null : NetworkImage(assetUrl('${c['profilePhotoUrl']}')),
              child: '${c['profilePhotoUrl']}'.isEmpty ? const Icon(Icons.person) : null,
            ),
            title: Text('${c['displayName']}'),
            subtitle: Text('${c['bio']}', maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: OutlinedButton(onPressed: () => _requestCreator(c), child: const Text('Select')),
          ),
      ]),
    );
  }

  Widget _requestsTab() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(children: [
        if (_requests.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No requests yet.'))),
        for (final r in _requests)
          ListTile(
            title: Text('${r['creatorDisplayName'] ?? r['creatorUsername'] ?? 'Creator'}'),
            subtitle: Text('${r['note'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis),
            trailing: Text('${r['status'] ?? ''}'),
          ),
      ]),
    );
  }
}
