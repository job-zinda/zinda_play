import 'package:flutter/material.dart';

import '../api.dart';

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
  String _type = 'member';
  bool _register = false;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_register) {
        await Api.instance.register(_user.text.trim(), _pass.text, referrer: _ref.text.trim(), accountType: _type, businessName: _business.text.trim());
      } else {
        await Api.instance.login(_user.text.trim(), _pass.text);
      }
      if (mounted) Navigator.pop(context);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_register ? 'Create account' : 'Sign in')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        TextField(controller: _user, decoration: const InputDecoration(labelText: 'Username')),
        const SizedBox(height: 12),
        TextField(controller: _pass, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
        if (_register) ...[
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'member', label: Text('Viewer')),
              ButtonSegment(value: 'business', label: Text('Business')),
              ButtonSegment(value: 'promoter', label: Text('Promoter')),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          if (_type == 'business') TextField(controller: _business, decoration: const InputDecoration(labelText: 'Business name')),
          if (_type == 'member') TextField(controller: _ref, decoration: const InputDecoration(labelText: 'Referral code (optional)')),
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
