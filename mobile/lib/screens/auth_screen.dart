import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import 'recovery_screen.dart';
import 'account_screen.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  final _ref = TextEditingController();
  final _business = TextEditingController();
  final _email = TextEditingController();
  String _type = 'member';
  bool _register = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    _ref.dispose();
    _business.dispose();
    _email.dispose();
    super.dispose();
  }

  void _openRecovery(String purpose) {
    Navigator.push(context, MaterialPageRoute<void>(builder: (_) => RecoveryScreen(initialPurpose: purpose)));
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (_register && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      setState(() => _error = 'Enter a valid email address. It is used to recover your password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_register) {
        await Api.instance.register(_user.text.trim(), _pass.text, email: email, referrer: _ref.text.trim(), accountType: _type, businessName: _business.text.trim());
      } else {
        await Api.instance.login(_user.text.trim(), _pass.text);
      }
      if (mounted) {
        if (_register && _type == 'creator') {
          Navigator.pushReplacement(context, MaterialPageRoute<void>(builder: (_) => const AccountScreen()));
        } else {
          Navigator.pop(context);
        }
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_register ? 'Create account' : 'Sign in (Viewer, Creator, Business or Promoter)', style: const TextStyle(fontSize: 16))),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        TextField(controller: _user, decoration: const InputDecoration(labelText: 'Username')),
        if (_register) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Email', helperText: 'Used to recover your password or username'),
          ),
        ],
        const SizedBox(height: 12),
        TextField(controller: _pass, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
        if (!_register)
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            TextButton(onPressed: _busy ? null : () => _openRecovery('password'), child: const Text('Forgot password?')),
            TextButton(onPressed: _busy ? null : () => _openRecovery('username'), child: const Text('Forgot username?')),
          ]),
        if (_register) ...[
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'member', label: Text('Viewer')),
              ButtonSegment(value: 'creator', label: Text('Creator')),
              ButtonSegment(value: 'business', label: Text('Business')),
              ButtonSegment(value: 'promoter', label: Text('Promoter')),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          if (_type == 'creator')
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Only creators need admin approval. Watch as a viewer right away; then add a required photo in your profile and submit for creator approval. An introduction video is optional and recommended for quicker approval.', style: TextStyle(fontSize: 12, color: Colors.white60)),
            )
          else
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Your account is ready immediately — no admin approval needed.', style: TextStyle(fontSize: 12, color: Colors.white60)),
            ),
          if (_type == 'business') TextField(controller: _business, decoration: const InputDecoration(labelText: 'Business name')),
          if (_type == 'member' || _type == 'creator')
            TextField(
              controller: _ref,
              keyboardType: TextInputType.number,
              maxLength: 6,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Invitation ID (optional)',
                hintText: '6-digit number',
              ),
            ),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Please wait…' : (_register ? 'Create account' : 'Sign in'))),
        TextButton(
          onPressed: () => setState(() => _register = !_register),
          child: Text(_register ? 'Already have an account? Sign in' : 'New here? Create an account'),
        ),
      ]),
    );
  }
}
