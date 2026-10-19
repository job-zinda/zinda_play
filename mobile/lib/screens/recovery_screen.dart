import 'package:flutter/material.dart';

import '../api.dart';

class RecoveryScreen extends StatefulWidget {
  const RecoveryScreen({super.key, this.initialPurpose = 'password'});

  final String initialPurpose;

  @override
  State<RecoveryScreen> createState() => _RecoveryScreenState();
}

class _RecoveryScreenState extends State<RecoveryScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  late String _purpose = widget.initialPurpose;
  bool _busy = false;
  String? _message, _error;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _message = null;
      _error = null;
    });
    try {
      final action = _purpose == 'reset' || _purpose == 'verify';
      final data = await Api.instance.post(
        action ? '/auth/account-action' : '/auth/recovery',
        action
            ? {
                'purpose': _purpose,
                'token': _code.text.trim(),
                'password': _password.text,
              }
            : {'purpose': _purpose, 'email': _email.text.trim()},
      ) as Map;
      if (_purpose == 'reset' && Api.instance.signedIn) {
        await Api.instance.logout();
        if (!mounted) return;
        Navigator.of(context).popUntil((route) => route.isFirst);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('${data['message']}')));
        return;
      }
      if (!mounted) return;
      setState(() => _message = '${data['message']}');
      _password.clear();
      _code.clear();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Account recovery')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'Use the recovery email you verified in your profile. If you never added one, contact support for help.',
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: _purpose,
          isExpanded: true,
          items: const [
            DropdownMenuItem(value: 'password', child: Text('Forgot password')),
            DropdownMenuItem(value: 'username', child: Text('Forgot username')),
            DropdownMenuItem(
              value: 'reset',
              child: Text('Reset password with email code'),
            ),
            DropdownMenuItem(
              value: 'verify',
              child: Text('Verify recovery email'),
            ),
          ],
          onChanged: _busy
              ? null
              : (value) => setState(() {
                  _purpose = value!;
                  _message = null;
                  _error = null;
                }),
        ),
        if (_purpose == 'password' || _purpose == 'username')
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              labelText: 'Verified recovery email',
            ),
          )
        else
          TextField(
            controller: _code,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Paste code from email',
            ),
          ),
        if (_purpose == 'reset')
          TextField(
            controller: _password,
            obscureText: true,
            maxLength: 128,
            decoration: const InputDecoration(
              labelText: 'New password (at least 8 characters)',
            ),
          ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: Text(
            _busy
                ? 'Please wait...'
                : _purpose == 'password' || _purpose == 'username'
                ? 'Send recovery email'
                : 'Confirm',
          ),
        ),
        if (_message != null) Text(_message!),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
      ],
    ),
  );
}
