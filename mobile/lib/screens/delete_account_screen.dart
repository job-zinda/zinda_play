import 'package:flutter/material.dart';

import '../api.dart';

class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api.instance.deleteAccount(_password.text, _confirmation.text);
      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error =
              '$error\nIf deletion has started, content remains disabled. Retry here to finish or contact jobzinda@gmail.com.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: Scaffold(
      appBar: AppBar(title: const Text('Delete account')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'This permanently removes your account, profile, uploaded videos and associated social content. Linked ads stop and all login sessions end. This cannot be undone.',
          ),
          const SizedBox(height: 12),
          const Text(
            'Necessary payment evidence, earnings, withdrawal and non-public ledger records may remain for reconciliation and legal obligations. Contact jobzinda@gmail.com about outstanding balances before deleting. Deletion does not automatically pay or refund them.',
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _password,
            obscureText: true,
            enabled: !_busy,
            decoration: const InputDecoration(labelText: 'Current password'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _confirmation,
            enabled: !_busy,
            decoration: const InputDecoration(
              labelText: 'Type DELETE to confirm',
            ),
            onChanged: (_) => setState(() {}),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.redAccent),
              ),
            ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed:
                _busy ||
                    _password.text.isEmpty ||
                    _confirmation.text != 'DELETE'
                ? null
                : _delete,
            child: Text(
              _busy ? 'Deleting account...' : 'Permanently delete account',
            ),
          ),
        ],
      ),
    ),
  );
}
