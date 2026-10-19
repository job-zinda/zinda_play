import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../public_links.dart';
import '../intro_video.dart';
import 'upload_screen.dart';
import 'wallet_screen.dart';
import 'membership_screen.dart';
import '../widgets/share_sheet.dart';
import 'account_screen.dart';

class StudioScreen extends StatefulWidget {
  const StudioScreen({super.key});
  @override
  State<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends State<StudioScreen> {
  final _api = Api.instance;
  Timer? _poll;

  Map<String, dynamic>? _account, _membership, _referrals, _wallet;
  List<Map<String, dynamic>> _videos = [];
  bool _loading = true;
  String? _error, _message;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(
      const Duration(seconds: 10),
      (_) => _refreshProcessing(),
    );
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Map<String, dynamic> _map(dynamic v) => Map<String, dynamic>.from(v as Map);

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        _api.get('/account'),
        _api.get('/creator/membership'),
        _api.get('/creator/referrals'),
        _api.get('/creator/wallet'),
        _api.get('/creator/videos'),
      ]);
      if (!mounted) return;
      setState(() {
        _account = _map(r[0]);
        _membership = _map(r[1]);
        _referrals = _map(r[2]);
        _wallet = _map(r[3]);
        _videos = (r[4] as List).map(_map).toList();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _loading = false;
        });
      }
    }
  }

  Future<void> _refreshProcessing() async {
    if (!mounted ||
        !_videos.any(
          (v) =>
              v['processingStatus'] != null &&
              v['processingStatus'] != 'ready' &&
              v['processingStatus'] != 'error',
        )) {
      return;
    }
    try {
      await _api.get('/creator/videos/processing');
      final list = await _api.get('/creator/videos') as List;
      if (mounted) setState(() => _videos = list.map(_map).toList());
    } catch (_) {}
  }

  Future<void> _subscribe() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const MembershipScreen()),
    );
    if (mounted) await _load();
  }

  Future<void> _pickPhoto() async {
    final picked = await FilePicker.pickFile(type: FileType.image);
    final path = picked?.path;
    if (path == null) return;
    final ext = path.split('.').last.toLowerCase();
    const types = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'gif': 'image/gif',
    };
    if (!types.containsKey(ext)) {
      setState(() => _error = 'Choose a JPEG, PNG, WebP, or GIF photo.');
      return;
    }
    try {
      await _api.uploadFile(
        'PUT',
        '/account/profile-photo',
        File(path),
        types[ext]!,
      );
      _message = 'Profile photo updated.';
      await _load();
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  Future<void> _editProfile() async {
    final name = TextEditingController(
      text: '${_account?['displayName'] ?? ''}',
    );
    final bio = TextEditingController(text: '${_account?['bio'] ?? ''}');
    final save = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit profile'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              maxLength: 60,
              decoration: const InputDecoration(labelText: 'Display name'),
            ),
            TextField(
              controller: bio,
              maxLength: 300,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Bio'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (save != true) return;
    try {
      await _api.patch('/account', {
        'displayName': name.text.trim(),
        'bio': bio.text.trim(),
      });
      await _load();
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  Future<void> _upload() async {
    final uploaded = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const UploadScreen()),
    );
    if (uploaded == true) {
      _message = 'Video uploaded. It will be reviewed before it is published.';
      await _load();
    }
  }

  Future<void> _deleteVideo(Map<String, dynamic> video) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete video?'),
        content: Text(
          'Delete "${video['title']}"? Linked ads will stop. Earned wallet credit and ad history will be retained. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting.add('${video['id']}'));
    try {
      await _api.delete('/creator/videos/${video['id']}');
      if (!mounted) return;
      setState(
        () => _message = 'Video deleted. Linked ads have stopped; earned credit is retained.',
      );
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _deleting.remove('${video['id']}'));
    }
  }

  final Set<String> _deleting = {};

  @override
  Widget build(BuildContext context) {
    final noPhoto = (_account?['profilePhotoUrl'] ?? '') == '';
    final expired = _membership?['status'] == 'expired';
    return Scaffold(
      appBar: AppBar(title: const Text('Creator studio'), actions: [
        if ('${_account?['id'] ?? ''}'.isNotEmpty)
          IconButton(tooltip: 'Share my profile', icon: const Icon(Icons.share),
            onPressed: () => showCreatorShareSheet(context, _account!)),
        IconButton(tooltip: 'Profile & account settings', icon: const Icon(Icons.manage_accounts_outlined),
          onPressed: () async {
            await Navigator.push(context, MaterialPageRoute(builder: (_) => const AccountScreen()));
            if (mounted) await _load();
          }),
      ]),
      floatingActionButton: _loading
          ? null
          : FloatingActionButton.extended(
              onPressed: noPhoto || expired ? null : _upload,
              icon: const Icon(Icons.upload),
              label: const Text('Upload'),
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  if (_error != null) _banner(_error!, Colors.redAccent),
                  if (_message != null) _banner(_message!, Colors.green),
                  _profileCard(noPhoto),
                  IntroManagerCard(
                    url: '${_account?['introVideoUrl'] ?? ''}',
                    onChanged: (url) => setState(
                      () => _account = {...?_account, 'introVideoUrl': url},
                    ),
                  ),
                  _membershipCard(),
                  _statsCard(),
                  _referralCard(),
                  const SizedBox(height: 12),
                  const Text(
                    'Your videos',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  if (_videos.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('No videos yet.'),
                    ),
                  for (final v in _videos) _videoTile(v),
                  const SizedBox(height: 80),
                ],
              ),
            ),
    );
  }

  Widget _banner(String text, Color color) => Card(
    color: color.withValues(alpha: 0.18),
    child: Padding(padding: const EdgeInsets.all(12), child: Text(text)),
  );

  Widget _profileCard(bool noPhoto) {
    final photo = assetUrl('${_account?['profilePhotoUrl'] ?? ''}');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundImage: photo.isEmpty ? null : NetworkImage(photo),
                  child: photo.isEmpty ? const Icon(Icons.person) : null,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_account?['displayName'] ?? ''}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        '@${_account?['username'] ?? ''}',
                        style: const TextStyle(color: Colors.white60),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _editProfile,
                  icon: const Icon(Icons.edit),
                ),
              ],
            ),
            if (noPhoto) ...[
              const SizedBox(height: 8),
              const Text(
                'A profile photo is required before you can upload videos.',
                style: TextStyle(color: Colors.orangeAccent),
              ),
            ],
            TextButton.icon(
              onPressed: _pickPhoto,
              icon: const Icon(Icons.photo_camera),
              label: Text(noPhoto ? 'Add profile photo' : 'Change photo'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _membershipCard() {
    final m = _membership!;
    final status = m['status'];
    final text = status == 'expired'
        ? 'Your free trial has ended. Upgrade to keep uploading.'
        : status == 'trial'
        ? 'Free trial: ${m['daysLeft']} day(s) left.'
        : 'Membership active: ${m['daysLeft']} day(s) left.';
    return Card(
      color: status == 'expired' ? Colors.red.withValues(alpha: 0.15) : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(child: Text(text)),
            FilledButton(
              onPressed: _subscribe,
              child: const Text('Plans & payments'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statsCard() {
    final w = _wallet!;
    final earned = (w['estimatedEarningsRupees'] as num).toStringAsFixed(2);
    return Card(
      child: InkWell(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const WalletScreen()),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _stat('${_videos.length}', 'Videos'),
              _stat('${w['totalViews']}', 'Views'),
              _stat('₹$earned', 'Earnings'),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stat(String value, String label) => Column(
    children: [
      Text(
        value,
        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
      ),
      Text(label, style: const TextStyle(color: Colors.white60)),
    ],
  );

  Widget _referralCard() {
    final code = '${_referrals?['referralCode']}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Invite people',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            SelectableText('Referral code: $code'),
            Text('${_referrals?['total']} joined through your code'),
            SelectableText(referralUrl(code)),
            TextButton.icon(
              onPressed: () => sharePublicLink(context, 'Join me on Zinda Play', referralUrl(code)),
              icon: const Icon(Icons.share),
              label: const Text('Share invitation'),
            ),
            TextButton.icon(
              onPressed: () => copyPublicLink(context, referralUrl(code)),
              icon: const Icon(Icons.link),
              label: const Text('Copy invitation link'),
            ),
            TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: code));
                if (mounted) setState(() => _message = 'Referral code copied.');
              },
              icon: const Icon(Icons.copy),
              label: const Text('Copy code'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _videoTile(Map<String, dynamic> v) {
    final thumb = assetUrl(v['thumbnailUrl'] as String?);
    final status = '${v['processingStatus'] ?? 'ready'}';
    final approval = '${v['approvalStatus'] ?? ''}';
    final label = status != 'ready'
        ? '$status · ${v['encodeProgress'] ?? 0}%'
        : (approval == 'pending'
              ? 'Awaiting approval'
              : (v['published'] == true ? 'Published' : 'Hidden'));
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: SizedBox(
        width: 80,
        height: 45,
        child: thumb.isEmpty
            ? Container(color: const Color(0xFF1B1F2A))
            : Image.network(
                thumb,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) =>
                    Container(color: const Color(0xFF1B1F2A)),
              ),
      ),
      title: Text(
        '${v['title']}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        '${v['videoType'] == 'short' ? 'Simply · ' : ''}${v['views'] ?? 0} views · $label${(v['shortValidationError'] ?? '').toString().isNotEmpty ? '\n${v['shortValidationError']}' : ''}',
      ),
      trailing: IconButton(
        tooltip: 'Delete ${v['title']}',
        onPressed: _deleting.contains('${v['id']}')
            ? null
            : () => _deleteVideo(v),
        icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
      ),
    );
  }
}
