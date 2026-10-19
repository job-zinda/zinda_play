import 'package:flutter/material.dart';

import '../api.dart';

class RecoveryScreen extends StatefulWidget {
  const RecoveryScreen({
    super.key,
    this.initialPurpose = 'password',
    this.initialEmail = '',
    this.signupVerification = false,
    this.verificationSent = true,
  });

  final String initialPurpose;
  final String initialEmail;
  final bool signupVerification;
  final bool verificationSent;

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
  void initState() {
    super.initState();
    _email.text = widget.initialEmail;
    if (widget.signupVerification && !widget.verificationSent) {
      _error = 'Your account is ready, but the verification email could not be sent. Tap Resend OTP to retry.';
    }
  }

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
                if (_purpose == 'verify') 'email': _email.text.trim(),
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
      if (widget.signupVerification && _purpose == 'verify') {
        final messenger = ScaffoldMessenger.of(context);
        Navigator.pop(context);
        messenger.showSnackBar(SnackBar(content: Text('${data['message']}')));
        return;
      }
      setState(() => _message = '${data['message']}');
      _password.clear();
      _code.clear();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    setState(() {
      _busy = true;
      _message = null;
      _error = null;
    });
    try {
      final data = await Api.instance.post('/account/verification-otp') as Map;
      if (mounted) {
        setState(() {
          _message = '${data['message']}';
          _code.clear();
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        widget.signupVerification ? 'Verify your email' : 'Account recovery',
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          widget.signupVerification
              ? 'Your member account is ready. Enter the six-digit OTP sent to ${widget.initialEmail}. You can also verify later without losing wallet access.'
              : 'Use the recovery email you verified in your profile. If you never added one, contact support for help.',
        ),
        const SizedBox(height: 16),
        if (!widget.signupVerification)
          DropdownButtonFormField<String>(
            initialValue: _purpose,
            isExpanded: true,
            items: const [
              DropdownMenuItem(
                value: 'password',
                child: Text('Forgot password'),
              ),
              DropdownMenuItem(
                value: 'username',
                child: Text('Forgot username'),
              ),
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
        if (_purpose == 'password' ||
            _purpose == 'username' ||
            _purpose == 'verify')
          TextField(
            controller: _email,
            readOnly: widget.signupVerification,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(
              labelText: _purpose == 'verify'
                  ? 'Email receiving the OTP'
                  : 'Verified recovery email',
            ),
          ),
        if (_purpose == 'verify' || _purpose == 'reset')
          TextField(
            controller: _code,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Paste code from email',
            ),
          ),
        if (_purpose == 'verify')
          const Text(
            'Enter the six-digit OTP from your email. It expires in 10 minutes. Older verification codes still work.',
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
        if (widget.signupVerification) ...[
          OutlinedButton(
            onPressed: _busy ? null : _resend,
            child: const Text('Resend OTP'),
          ),
          TextButton(
            onPressed: _busy ? null : () => Navigator.pop(context),
            child: const Text('Verify later'),
          ),
        ],
        if (_message != null) Text(_message!),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
      ],
    ),
  );
}
