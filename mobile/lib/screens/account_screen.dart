import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../intro_video.dart';

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  Map<String, dynamic>? _profile, _security;
  bool _loading = true, _busy = false;
  String? _error, _message;
  bool get _business => Api.instance.role == 'business';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final security = Map<String, dynamic>.from(
        await Api.instance.get('/account/security') as Map,
      );
      final profile = _business
          ? null
          : Map<String, dynamic>.from(
              await Api.instance.get('/account') as Map,
            );
      if (!mounted) return;
      _username.text = '${security['username']}';
      setState(() {
        _security = security;
        _profile = profile;
        _loading = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = '$error';
          _loading = false;
        });
      }
    }
  }

  Future<void> _run(Future<String> Function() action) async {
    setState(() {
      _busy = true;
      _message = null;
      _error = null;
    });
    try {
      final message = await action();
      if (!mounted) return;
      setState(() => _message = message);
      _password.clear();
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _photo() async {
    try {
      final file = await FilePicker.pickFile(type: FileType.image);
      final path = file?.path;
      if (path == null || !mounted) return;
      await _run(() async {
        const types = {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'webp': 'image/webp',
          'gif': 'image/gif',
        };
        final type = types[path.split('.').last.toLowerCase()];
        if (type == null) {
          throw ApiException('Choose a JPEG, PNG, WebP, or GIF photo.');
        }
        final image = File(path);
        if (await image.length() > 8 * 1024 * 1024) {
          throw ApiException('Profile photos are limited to 8 MB.');
        }
        await Api.instance.uploadFile(
          'PUT',
          '/account/profile-photo',
          image,
          type,
        );
        return 'Profile photo saved.';
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _apply() => _run(() async {
    await Api.instance.post('/account/creator-application');
    await Api.instance.refreshAccountRole();
    return 'Application submitted. Your member wallet and referrals remain available while creator approval is pending.';
  });

  @override
  Widget build(BuildContext context) {
    final applying =
        !_business && _profile != null && _profile!['role'] != 'creator';
    final photo = assetUrl(_profile?['profilePhotoUrl'] as String?);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile & account settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (_error != null)
                    Text(
                      _error!,
                      style: const TextStyle(color: Colors.redAccent),
                    ),
                  if (_message != null)
                    Text(
                      _message!,
                      style: const TextStyle(color: Colors.green),
                    ),
                  if (_security == null)
                    TextButton(onPressed: _load, child: const Text('Retry')),
                  if (_profile != null) ...[
                    CircleAvatar(
                      radius: 38,
                      backgroundImage: photo.isEmpty
                          ? null
                          : NetworkImage(photo),
                      child: photo.isEmpty ? const Icon(Icons.person) : null,
                    ),
                    TextButton.icon(
                      onPressed: _busy ? null : _photo,
                      icon: const Icon(Icons.photo_camera),
                      label: Text(
                        applying
                            ? '1. Add profile photo (required)'
                            : 'Change profile photo',
                      ),
                    ),
                    if (applying) ...[
                      const Text(
                        'Become a creator',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Text(
                        'Your member wallet and referrals remain available while creator approval is pending.',
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        '2. Introduction video (optional). Recommended for quicker approval.',
                      ),
                      IntroManagerCard(
                        url: '${_profile?['introVideoUrl'] ?? ''}',
                        onChanged: (url) => setState(
                          () => _profile = {...?_profile, 'introVideoUrl': url},
                        ),
                      ),
                      if (_profile?['approvalStatus'] == 'pending')
                        const Text(
                          'Your creator application is awaiting approval. Continue watching and earning as a member.',
                        )
                      else ...[
                        if (_profile?['approvalStatus'] == 'rejected')
                          const Text(
                            'Your last application was declined. Update your profile before applying again.',
                          ),
                        FilledButton(
                          onPressed: _busy || photo.isEmpty ? null : _apply,
                          child: const Text('Submit for approval'),
                        ),
                      ],
                    ],
                  ],
                  const Divider(height: 32),
                  const Text(
                    'Username & account settings',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  if (_security != null) ...[
                    const Text(
                      'Use your current password to change your username. Email verification and email recovery are unavailable.',
                    ),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      maxLength: 128,
                      decoration: const InputDecoration(
                        labelText: 'Current password',
                      ),
                    ),
                    TextField(
                      controller: _username,
                      maxLength: 32,
                      decoration: const InputDecoration(
                        labelText: 'New username',
                      ),
                    ),
                    OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => _run(() async {
                              final data = await Api.instance.patch(
                                '/account/username',
                                {
                                  'username': _username.text.trim(),
                                  'password': _password.text,
                                },
                              ) as Map;
                              await Api.instance.updateUsername(
                                '${data['username']}',
                              );
                              return '${data['message']}';
                            }),
                      child: const Text('Change username'),
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}
