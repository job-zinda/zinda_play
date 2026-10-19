import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    _ref.dispose();
    _business.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_register) {
        await Api.instance.register(
          _user.text.trim(),
          _pass.text,
          referrer: _ref.text.trim(),
          accountType: _type,
          businessName: _business.text.trim(),
        );
      } else {
        await Api.instance.login(_user.text.trim(), _pass.text);
      }
      if (mounted) {
        Navigator.pop(context);
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
      appBar: AppBar(
        title: Text(
          _register ? 'Create account' : 'Sign in',
          style: const TextStyle(fontSize: 16),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _user,
            decoration: const InputDecoration(labelText: 'Username'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _pass,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Password'),
          ),
          if (_register) ...[
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'member', label: Text('Member')),
                ButtonSegment(value: 'business', label: Text('Business')),
              ],
              selected: {_type},
              onSelectionChanged: _busy
                  ? null
                  : (s) => setState(() => _type = s.first),
            ),
            if (_type == 'member')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Join immediately as a member, with wallet and referral rewards. No approval needed. You can apply for creator access from your profile later.',
                  style: TextStyle(fontSize: 12, color: Colors.white60),
                ),
              )
            else
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Your account is ready immediately — no admin approval needed.',
                  style: TextStyle(fontSize: 12, color: Colors.white60),
                ),
              ),
            if (_type == 'business')
              TextField(
                controller: _business,
                decoration: const InputDecoration(labelText: 'Business name'),
              ),
            if (_type == 'member')
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
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.redAccent),
              ),
            ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(
              _busy
                  ? 'Please wait…'
                  : (_register ? 'Create account' : 'Sign in'),
            ),
          ),
          TextButton(
            onPressed: () => setState(() => _register = !_register),
            child: Text(
              _register
                  ? 'Already have an account? Sign in'
                  : 'New here? Create an account',
            ),
          ),
        ],
      ),
    );
  }
}
