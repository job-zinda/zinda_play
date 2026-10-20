import 'package:flutter/material.dart';

const _purple = Color(0xFFAC6CFF);
const _muted = Color(0xFFB2ADCE);

class VideoEngagementCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;

  const VideoEngagementCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0x664E3B82)),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xEE19162D), Color(0xEE0F101D)],
      ),
    ),
    child: child,
  );
}

class VideoEngagementBar extends StatelessWidget {
  final bool liked;
  final bool saved;
  final int likes;
  final int comments;
  final bool loading;
  final bool liking;
  final bool saving;
  final VoidCallback onLike;
  final VoidCallback onComments;
  final VoidCallback onShare;
  final VoidCallback onSave;

  const VideoEngagementBar({
    super.key,
    required this.liked,
    required this.saved,
    required this.likes,
    required this.comments,
    required this.loading,
    required this.liking,
    required this.saving,
    required this.onLike,
    required this.onComments,
    required this.onShare,
    required this.onSave,
  });

  @override
  Widget build(BuildContext context) {
    final actions = [
      _EngagementAction(
        label: 'Like',
        count: loading ? null : likes,
        selected: liked,
        busy: liking,
        onTap: loading || liking ? null : onLike,
        icon: Icons.favorite_rounded,
        colors: const [Color(0xFFFF4B9B), Color(0xFFFFA568)],
        animate: true,
      ),
      _EngagementAction(
        label: 'Comments',
        count: loading ? null : comments,
        icon: Icons.chat_bubble_outline_rounded,
        colors: const [Color(0xFFBC69FF), Color(0xFF7027F5)],
        onTap: onComments,
      ),
      _EngagementAction(
        label: 'Share',
        icon: Icons.send_outlined,
        onTap: onShare,
      ),
      _EngagementAction(
        label: saved ? 'Saved' : 'Save',
        icon: saved ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
        selected: saved,
        busy: saving,
        onTap: saving ? null : onSave,
      ),
    ];
    return VideoEngagementCard(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < actions.length; i++) ...[
              if (i > 0)
                const VerticalDivider(
                  width: 1,
                  indent: 12,
                  endIndent: 12,
                  color: Color(0x664E3B82),
                ),
              Expanded(child: actions[i]),
            ],
          ],
        ),
      ),
    );
  }
}

class _EngagementAction extends StatelessWidget {
  final String label;
  final int? count;
  final IconData icon;
  final List<Color>? colors;
  final bool selected;
  final bool busy;
  final bool animate;
  final VoidCallback? onTap;

  const _EngagementAction({
    required this.label,
    required this.icon,
    this.count,
    this.colors,
    this.selected = false,
    this.busy = false,
    this.animate = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final glow = colors;
    final badge = AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      width: 36,
      height: 36,
      decoration: glow == null
          ? null
          : BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: glow),
              border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
              boxShadow: [
                BoxShadow(
                  color: glow.first.withValues(alpha: selected ? 0.4 : 0.2),
                  blurRadius: selected ? 14 : 8,
                ),
              ],
            ),
      child: busy
          ? const Padding(
              padding: EdgeInsets.all(9),
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          : Icon(
              animate && !selected ? Icons.favorite_border_rounded : icon,
              size: 22,
              color: selected && glow == null ? _purple : Colors.white,
            ),
    );
    return Semantics(
      button: true,
      selected: selected,
      label: '$label${count == null ? '' : ', $count'}',
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (animate)
                  TweenAnimationBuilder<double>(
                    key: ValueKey(selected),
                    tween: Tween(begin: selected ? 0.8 : 1, end: 1),
                    duration: Duration(
                      milliseconds: MediaQuery.disableAnimationsOf(context)
                          ? 0
                          : 320,
                    ),
                    curve: Curves.easeOutBack,
                    builder: (_, scale, child) =>
                        Transform.scale(scale: scale, child: child),
                    child: badge,
                  )
                else
                  badge,
                const SizedBox(height: 5),
                Text(
                  count == null ? '' : '$count',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: _muted, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class VideoCommentsEmptyState extends StatelessWidget {
  const VideoCommentsEmptyState({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 20),
    child: Column(
      children: [
        SizedBox(
          width: 100,
          height: 70,
          child: CustomPaint(painter: _CommentsIllustration()),
        ),
        SizedBox(height: 10),
        Text(
          'No comments yet',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        SizedBox(height: 5),
        Text(
          'Be the first to share your thoughts!',
          textAlign: TextAlign.center,
          style: TextStyle(color: _muted, fontSize: 12, height: 1.4),
        ),
      ],
    ),
  );
}

class _CommentsIllustration extends CustomPainter {
  const _CommentsIllustration();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 100, size.height / 70);
    final back = Path()
      ..moveTo(58, 29)
      ..lineTo(82, 29)
      ..quadraticBezierTo(91, 29, 91, 38)
      ..lineTo(91, 49)
      ..quadraticBezierTo(91, 57, 83, 57)
      ..lineTo(83, 65)
      ..lineTo(72, 57)
      ..lineTo(58, 57)
      ..close();
    canvas.drawPath(back, Paint()..color = const Color(0x557027F5));
    final outline = Paint()
      ..color = _purple
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(back, outline);
    final front = Path()
      ..moveTo(25, 7)
      ..lineTo(64, 7)
      ..quadraticBezierTo(77, 7, 77, 20)
      ..lineTo(77, 36)
      ..quadraticBezierTo(77, 47, 64, 47)
      ..lineTo(43, 47)
      ..lineTo(29, 60)
      ..lineTo(29, 47)
      ..lineTo(25, 47)
      ..quadraticBezierTo(14, 47, 14, 36)
      ..lineTo(14, 20)
      ..quadraticBezierTo(14, 7, 25, 7)
      ..close();
    canvas.drawPath(front, Paint()..color = const Color(0xFF292044));
    canvas.drawPath(front, outline);
    for (final x in [32.0, 45.0, 58.0]) {
      canvas.drawCircle(Offset(x, 27), 3, Paint()..color = _purple);
    }
    canvas.drawLine(const Offset(84, 12), const Offset(88, 5), outline);
    canvas.drawLine(
      const Offset(90, 20),
      const Offset(97, 18),
      Paint()
        ..color = const Color(0xFFFF8F9D)
        ..strokeWidth = 2.5,
    );
    canvas.drawLine(const Offset(5, 34), const Offset(0, 31), outline);
    canvas.drawLine(const Offset(6, 44), const Offset(0, 46), outline);
  }

  @override
  bool shouldRepaint(_CommentsIllustration oldDelegate) => false;
}
