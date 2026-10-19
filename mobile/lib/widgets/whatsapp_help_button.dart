import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../public_links.dart';

class WhatsAppHelpButton extends StatelessWidget {
  const WhatsAppHelpButton({super.key});

  Future<void> _open(BuildContext context) async {
    try {
      if (!await launchUrl(
        Uri.parse(whatsAppHelpUrl),
        mode: LaunchMode.externalApplication,
      )) {
        throw ApiException('Could not open WhatsApp. Please try again.');
      }
    } on Exception catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$error')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => FloatingActionButton.extended(
    heroTag: 'whatsapp-help',
    backgroundColor: const Color(0xFF128C4B),
    foregroundColor: Colors.white,
    tooltip: 'Ask me on WhatsApp',
    onPressed: () => _open(context),
    icon: const SizedBox(
      width: 24,
      height: 24,
      child: CustomPaint(painter: _WhatsAppIconPainter()),
    ),
    label: const Text('Ask me'),
  );
}

class _WhatsAppIconPainter extends CustomPainter {
  const _WhatsAppIconPainter();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final bubble = Path()
      ..moveTo(5, 19.5)
      ..lineTo(2.5, 21)
      ..lineTo(3.7, 16.5)
      ..arcToPoint(
        const Offset(5, 19.5),
        radius: const Radius.circular(9.5),
        largeArc: true,
      );
    final phone = Path()
      ..moveTo(8, 6)
      ..lineTo(10, 9)
      ..lineTo(8.5, 10.5)
      ..quadraticBezierTo(10, 14, 13.5, 15.5)
      ..lineTo(15, 14)
      ..lineTo(18, 16)
      ..cubicTo(17, 21, 6, 15, 6, 9)
      ..cubicTo(6, 7, 7, 6, 8, 6);
    canvas.drawPath(bubble, paint);
    canvas.drawPath(phone, paint);
  }

  @override
  bool shouldRepaint(covariant _WhatsAppIconPainter oldDelegate) => false;
}
