import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../api.dart';

class BusinessScreen extends StatefulWidget {
  const BusinessScreen({super.key});
  @override
  State<BusinessScreen> createState() => _BusinessScreenState();
}

class _BusinessScreenState extends State<BusinessScreen> {
  final _api = Api.instance;
  late final Razorpay _razorpay;
  Timer? _poll;
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _videos = [], _creators = [], _requests = [];
  bool _loading = true;
  String? _error, _message, _pendingCampaignId;
  double _progress = 0;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay()
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaid)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) => setState(() => _error = 'Payment failed: ${r.message ?? 'cancelled'}'));
    _load();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _refreshProcessing());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _razorpay.clear();
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

  static const _videoTypes = {
    'mp4': 'video/mp4', 'mov': 'video/quicktime', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
    'avi': 'video/x-msvideo', 'wmv': 'video/x-ms-wmv', 'mpeg': 'video/mpeg', 'mpg': 'video/mpeg',
    '3gp': 'video/3gpp', 'm4v': 'video/x-m4v',
  };

  Future<void> _upload() async {
    final title = TextEditingController();
    final description = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Upload promotional video'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: title, maxLength: 120, decoration: const InputDecoration(labelText: 'Title')),
          TextField(controller: description, maxLength: 2000, maxLines: 3, decoration: const InputDecoration(labelText: 'Description')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Choose video')),
        ],
      ),
    );
    if (go != true || title.text.trim().isEmpty) {
      if (go == true) setState(() => _error = 'Enter a title.');
      return;
    }
    final picked = await FilePicker.pickFile(type: FileType.video);
    final path = picked?.path;
    if (path == null) return;
    final type = _videoTypes[path.split('.').last.toLowerCase()];
    if (type == null) {
      setState(() => _error = 'Choose an MP4, MOV, WebM, MKV, AVI, WMV, MPEG or 3GP video.');
      return;
    }
    setState(() { _uploading = true; _progress = 0; _error = null; });
    try {
      await _api.uploadFile('POST', '/business/videos/upload', File(path), type, headers: {
        'X-Video-Title': title.text.trim(),
        'X-Video-Description': description.text.trim(),
        'X-Video-Category': 'cat-learning',
        'X-Video-Published': 'false',
        'X-Video-Featured': 'false',
      }, onProgress: (p) => setState(() => _progress = p));
      _message = 'Video uploaded. It will be reviewed before you can promote it.';
      await _load();
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _promote(Map<String, dynamic> video) async {
    final country = TextEditingController(text: 'IN');
    final region = TextEditingController();
    var thousands = 1;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Promote video'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: country, maxLength: 2, decoration: const InputDecoration(labelText: 'Country code (e.g. IN)')),
            TextField(controller: region, maxLength: 12, decoration: const InputDecoration(labelText: 'State/region code (optional, e.g. MH)')),
            Row(children: [
              IconButton(onPressed: thousands > 1 ? () => setLocal(() => thousands--) : null, icon: const Icon(Icons.remove)),
              Expanded(child: Text('${thousands * 1000} impressions · ₹${thousands * 500}', textAlign: TextAlign.center)),
              IconButton(onPressed: thousands < 1000 ? () => setLocal(() => thousands++) : null, icon: const Icon(Icons.add)),
            ]),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Pay & promote')),
          ],
        ),
      ),
    );
    if (go != true) return;
    try {
      final order = _map(await _api.post('/business/videos/${video['id']}/campaign-order', {
        'countryCode': country.text.trim().toUpperCase(),
        'regionCode': region.text.trim().toUpperCase(),
        'targetImpressions': thousands * 1000,
      }));
      _pendingCampaignId = '${order['campaignId']}';
      _razorpay.open({
        'key': order['keyId'],
        'amount': order['amount'],
        'currency': order['currency'],
        'order_id': order['orderId'],
        'name': 'Zinda Play',
        'description': 'Video promotion',
      });
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  Future<void> _onPaid(PaymentSuccessResponse r) async {
    final id = _pendingCampaignId;
    if (id == null) return;
    try {
      await _api.post('/business/campaigns/$id/verify-payment', {
        'razorpay_order_id': r.orderId,
        'razorpay_payment_id': r.paymentId,
        'razorpay_signature': r.signature,
      });
      _message = 'Payment confirmed. Your promotion is live.';
      _error = null;
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
          bottom: const TabBar(tabs: [Tab(text: 'Videos'), Tab(text: 'Creators'), Tab(text: 'Requests')]),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(children: [
                if (_error != null) Card(color: Colors.red.withValues(alpha: 0.18), child: Padding(padding: const EdgeInsets.all(12), child: Text(_error!))),
                if (_message != null) Card(color: Colors.green.withValues(alpha: 0.18), child: Padding(padding: const EdgeInsets.all(12), child: Text(_message!))),
                if (_uploading) LinearProgressIndicator(value: _progress),
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
        FilledButton.icon(onPressed: _uploading ? null : _upload, icon: const Icon(Icons.upload), label: const Text('Upload promotional video')),
        const SizedBox(height: 8),
        if (_videos.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No videos yet.'))),
        for (final v in _videos) _videoTile(v),
      ]),
    );
  }

  Widget _videoTile(Map<String, dynamic> v) {
    final campaign = v['campaign'] as Map<String, dynamic>?;
    final processing = '${v['processingStatus'] ?? 'ready'}';
    final canPromote = v['approvalStatus'] == 'approved' && processing == 'ready' && ['unpaid', 'awaiting_payment'].contains(v['businessCampaignStatus']);
    final status = processing != 'ready'
        ? '$processing · ${v['encodeProgress'] ?? 0}%'
        : campaign != null && campaign['status'] == 'active'
            ? 'Live · ${campaign['impressions']}/${campaign['targetImpressions']} impressions'
            : v['approvalStatus'] == 'approved' ? 'Approved' : 'Awaiting approval';
    return Card(
      child: ListTile(
        title: Text('${v['title']}', maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(status),
        trailing: canPromote ? FilledButton(onPressed: () => _promote(v), child: const Text('Promote')) : null,
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
