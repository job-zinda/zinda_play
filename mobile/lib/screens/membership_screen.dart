import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';

class MembershipScreen extends StatefulWidget {
  const MembershipScreen({super.key});

  @override
  State<MembershipScreen> createState() => _MembershipScreenState();
}

class _MembershipScreenState extends State<MembershipScreen> {
  final _api = Api.instance;
  Map<String, dynamic>? _membership;
  List<Map<String, dynamic>> _payments = [];
  String? _planId, _error, _message, _contentType;
  File? _file;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _api.get('/creator/membership'),
        _api.get('/creator/membership/payments'),
      ]);
      if (!mounted) return;
      final membership = Map<String, dynamic>.from(results[0] as Map);
      final plans = (membership['plans'] as List)
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList();
      setState(() {
        _membership = membership;
        _payments = (results[1] as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        if (!plans.any((plan) => plan['id'] == _planId)) {
          _planId = plans.isEmpty ? null : plans.first['id'] as String;
        }
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _pickScreenshot() async {
    try {
      final picked = await FilePicker.pickFile(type: FileType.image);
      final path = picked?.path;
      if (path == null || !mounted) return;
      const types = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
      };
      final type = types[path.split('.').last.toLowerCase()];
      final file = File(path);
      final size = await file.length();
      if (!mounted) return;
      if (type == null || size == 0 || size > 8 * 1024 * 1024) {
        setState(
          () => _error = 'Choose a JPEG, PNG, or WebP screenshot up to 8 MB.',
        );
        return;
      }
      setState(() {
        _file = file;
        _contentType = type;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _submit(Map<String, dynamic> plan) async {
    final file = _file;
    final type = _contentType;
    if (file == null || type == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      final query = Uri(
        queryParameters: {
          'planId': '${plan['id']}',
          'priceRupees': '${plan['priceRupees']}',
          'durationDays': '${plan['durationDays']}',
        },
      ).query;
      await _api.uploadFile(
        'POST',
        '/creator/membership/payments?$query',
        file,
        type,
      );
      if (!mounted) return;
      setState(() {
        _file = null;
        _message = 'Screenshot submitted for manual review. Do not pay again. Membership starts only after approval.';
      });
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final membership = _membership;
    final plans = (membership?['plans'] as List? ?? [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final selected = plans.where((plan) => plan['id'] == _planId).firstOrNull;
    final pending = _payments.any(
      (payment) => ['pending', 'approving'].contains(payment['status']),
    );
    final qrUrl = membership?['qrUrl'] as String?;
    return Scaffold(
      appBar: AppBar(title: const Text('Creator membership')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null)
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          if (_message != null)
            Text(_message!, style: const TextStyle(color: Colors.greenAccent)),
          OutlinedButton(
            onPressed: _busy ? null : _load,
            child: const Text('Refresh payment status'),
          ),
          if (membership == null)
            const Center(child: CircularProgressIndicator())
          else ...[
            Text(
              '${membership['status']} - ${membership['daysLeft']} day(s) left',
            ),
            const SizedBox(height: 16),
            if (pending)
              const Text(
                'Payment awaiting manual review. Do not pay or submit again. Your current expiry stays unchanged until approval.',
              )
            else if (qrUrl == null)
              const Text(
                'The administrator has not added a payment QR yet. Please do not pay.',
              )
            else ...[
              DropdownButtonFormField<String>(
                initialValue: _planId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Choose plan'),
                items: plans
                    .map(
                      (plan) => DropdownMenuItem(
                        value: plan['id'] as String,
                        child: Text(
                          '${plan['name']} - INR ${plan['priceRupees']} / ${plan['durationDays']} days',
                        ),
                      ),
                    )
                    .toList(),
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _planId = value),
              ),
              const SizedBox(height: 16),
              Text(
                '1. Scan this QR with your payment app and pay exactly INR ${selected?['priceRupees']}. Verify the recipient before paying.',
              ),
              const SizedBox(height: 12),
              Center(
                child: Container(
                  color: Colors.white,
                  padding: const EdgeInsets.all(12),
                  child: Image.network(
                    assetUrl(qrUrl),
                    width: 260,
                    height: 260,
                    errorBuilder: (_, error, stack) => const SizedBox(
                      width: 260,
                      child: Text(
                        'Could not load payment QR. Refresh before paying.',
                        style: TextStyle(color: Colors.red),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                '2. Upload the successful payment screenshot. Only administrators can see it. Membership is activated after they verify funds received. No automatic recurring charge.',
              ),
              OutlinedButton(
                onPressed: _busy ? null : _pickScreenshot,
                child: Text(
                  _file == null
                      ? 'Choose screenshot (max 8 MB)'
                      : 'Screenshot selected - change',
                ),
              ),
              FilledButton(
                onPressed: _busy || _file == null || selected == null
                    ? null
                    : () => _submit(selected),
                child: Text(
                  _busy ? 'Submitting...' : 'Submit payment for approval',
                ),
              ),
            ],
            const SizedBox(height: 24),
            Text(
              'Payment history',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            if (_payments.isEmpty) const Text('No payments submitted.'),
            ..._payments.map((payment) {
              final plan = Map<String, dynamic>.from(payment['plan'] as Map);
              return Card(
                child: ListTile(
                  title: Text('${plan['name']} - INR ${plan['priceRupees']}'),
                  subtitle: Text(
                    '${payment['status'] == 'approving' ? 'pending' : payment['status']}\n${payment['createdAt']}${payment['reason'] == null ? '' : '\nReason: ${payment['reason']}'}',
                  ),
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}
