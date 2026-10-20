import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';

class AuthScreen extends StatefulWidget {
  /// Opens member sign-up with this invitation ID filled in.
  final String? referralCode;
  const AuthScreen({super.key, this.referralCode});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  late final _ref = TextEditingController(text: widget.referralCode ?? '');
  final _business = TextEditingController();
  String _type = 'member';
  late bool _register = widget.referralCode != null;
  bool _busy = false;
  bool _showPassword = false;
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
    if (_busy) return;
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

  InputDecoration _decoration(
    String label,
    IconData icon, {
    String? hint,
    Widget? suffix,
  }) => InputDecoration(
    labelText: label,
    hintText: hint,
    labelStyle: const TextStyle(color: Color(0xFFC5BEDC)),
    hintStyle: const TextStyle(color: Color(0xFF9389AE)),
    prefixIcon: Icon(icon, color: const Color(0xFFC18AFF)),
    suffixIcon: suffix,
    filled: true,
    fillColor: const Color(0xFF141320),
    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 22),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(20)),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(20),
      borderSide: const BorderSide(color: Color(0xFF51436E)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(20),
      borderSide: const BorderSide(color: Color(0xFFBA75FF), width: 2),
    ),
    counterStyle: const TextStyle(color: Color(0xFFB2ADCE)),
  );

  Widget _accountCard(
    String value,
    String title,
    String subtitle,
    IconData icon,
  ) {
    final selected = _type == value;
    return Expanded(
      child: Semantics(
        selected: selected,
        button: true,
        child: AnimatedContainer(
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 180),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: LinearGradient(
              colors: selected
                  ? const [Color(0xFF59209D), Color(0xFF7426E4)]
                  : const [Color(0xFF171524), Color(0xFF101019)],
            ),
            border: Border.all(
              color: selected
                  ? const Color(0xFFD58AFF)
                  : const Color(0xFF51436E),
              width: selected ? 2 : 1,
            ),
            boxShadow: selected
                ? const [BoxShadow(color: Color(0x337C3AED), blurRadius: 18)]
                : null,
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: _busy ? null : () => setState(() => _type = value),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(icon, color: const Color(0xFFDAB6FF), size: 27),
                        const Spacer(),
                        Icon(
                          selected ? Icons.check_circle : Icons.circle_outlined,
                          color: selected
                              ? Colors.white
                              : const Color(0xFF9389AE),
                          size: 22,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFFD1C5E9),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF080810),
      appBar: AppBar(
        backgroundColor: const Color(0xFF080810),
        foregroundColor: Colors.white,
        title: Text(
          _register ? 'Create account' : 'Sign in',
          style: const TextStyle(fontSize: 16),
        ),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _register ? 'Join Zinda Play' : 'Welcome back',
                            style: const TextStyle(
                              fontSize: 30,
                              height: 1.2,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFFD49CFF),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            _register
                                ? 'Create your account and start watching.'
                                : 'Sign in and pick up where you left off.',
                            style: const TextStyle(
                              fontSize: 14,
                              height: 1.5,
                              color: Color(0xFFB2ADCE),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(22),
                        gradient: const LinearGradient(
                          colors: [Color(0xFFAB46F5), Color(0xFF4E1696)],
                        ),
                        boxShadow: const [
                          BoxShadow(color: Color(0x557C3AED), blurRadius: 28),
                        ],
                      ),
                      child: const Icon(
                        Icons.play_arrow_rounded,
                        color: Colors.white,
                        size: 36,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 28),
                AutofillGroup(
                  child: Column(
                    children: [
                      TextField(
                        controller: _user,
                        style: const TextStyle(color: Colors.white),
                        autocorrect: false,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        decoration: _decoration(
                          'Username',
                          Icons.person_rounded,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _pass,
                        obscureText: !_showPassword,
                        style: const TextStyle(color: Colors.white),
                        autocorrect: false,
                        enableSuggestions: false,
                        autofillHints: [
                          _register
                              ? AutofillHints.newPassword
                              : AutofillHints.password,
                        ],
                        onSubmitted: (_) {
                          if (!_busy && !_register) _submit();
                        },
                        decoration: _decoration(
                          'Password',
                          Icons.lock_rounded,
                          suffix: IconButton(
                            tooltip: _showPassword
                                ? 'Hide password'
                                : 'Show password',
                            onPressed: () =>
                                setState(() => _showPassword = !_showPassword),
                            icon: Icon(
                              _showPassword
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                              color: const Color(0xFFC5BEDC),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_register) ...[
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _accountCard(
                        'member',
                        'Member',
                        'For viewers & creators',
                        Icons.person_rounded,
                      ),
                      const SizedBox(width: 12),
                      _accountCard(
                        'business',
                        'Business',
                        'For brands & sellers',
                        Icons.storefront_outlined,
                      ),
                    ],
                  ),
                  if (_type == 'member')
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(
                        'Watch, earn rewards, and invite friends. Join immediately with no approval needed. Apply for creator access from your profile anytime.',
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.6,
                          color: Color(0xFFB2ADCE),
                        ),
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
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: TextField(
                        controller: _business,
                        style: const TextStyle(color: Colors.white),
                        decoration: _decoration(
                          'Business name',
                          Icons.storefront_outlined,
                        ),
                      ),
                    ),
                  if (_type == 'member')
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: TextField(
                        controller: _ref,
                        style: const TextStyle(color: Colors.white),
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                        decoration: _decoration(
                          'Invitation ID (optional)',
                          Icons.card_giftcard_rounded,
                          hint: 'Enter 6-digit referral code',
                        ),
                      ),
                    ),
                ],
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.redAccent),
                      semanticsLabel: _error,
                    ),
                  ),
                const SizedBox(height: 20),
                DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(28),
                    gradient: const LinearGradient(
                      colors: [Color(0xFFC75CFF), Color(0xFF852EFF)],
                    ),
                    boxShadow: _busy
                        ? null
                        : const [
                            BoxShadow(
                              color: Color(0x557C3AED),
                              blurRadius: 24,
                              offset: Offset(0, 6),
                            ),
                          ],
                  ),
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      disabledBackgroundColor: const Color(0xFF373044),
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(56),
                    ),
                    onPressed: _busy ? null : _submit,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        if (_busy) ...[
                          const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 10),
                        ],
                        Flexible(
                          child: Text(
                            _busy
                                ? 'Please wait…'
                                : (_register ? 'Create account' : 'Sign in'),
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                            ),
                          ),
                        ),
                        if (!_busy) ...[
                          const SizedBox(width: 12),
                          const Icon(Icons.chevron_right_rounded),
                        ],
                      ],
                    ),
                  ),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFFC18AFF),
                    minimumSize: const Size.fromHeight(48),
                  ),
                  onPressed: _busy
                      ? null
                      : () => setState(() => _register = !_register),
                  child: Text(
                    _register
                        ? 'Already have an account? Sign in'
                        : 'New here? Create an account',
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
