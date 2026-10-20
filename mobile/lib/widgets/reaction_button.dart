import 'package:flutter/material.dart';

import '../engagement.dart';

class ReactionButton extends StatelessWidget {
  final String? reaction;
  final int? count;
  final Map<String, dynamic>? counts;
  final bool busy;
  final bool inline;
  final ValueChanged<String>? onReact;

  const ReactionButton({
    super.key,
    this.reaction,
    this.count,
    this.counts,
    this.busy = false,
    this.inline = false,
    this.onReact,
  });

  Future<void> _choose(BuildContext context) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (context) => SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Choose reaction', style: TextStyle(fontSize: 18)),
            const SizedBox(height: 12),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final choice in reactionChoices)
                  Semantics(
                    selected: reaction == choice.type,
                    child: OutlinedButton(
                      style: const ButtonStyle(enableFeedback: false),
                      onPressed: () => Navigator.pop(context, choice.type),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            choice.emoji,
                            style: const TextStyle(fontSize: 28),
                          ),
                          Text(choice.label),
                          Text('${counts?[choice.type] ?? 0}'),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
    if (selected != null && context.mounted) onReact?.call(selected);
  }

  @override
  Widget build(BuildContext context) {
    final choice = reactionChoices
        .where((item) => item.type == reaction)
        .firstOrNull;
    final enabled = !busy && onReact != null;
    final main = Tooltip(
      message: '${count ?? 0} likes',
      child: Semantics(
        selected: reaction != null,
        button: true,
        label: '${choice?.label ?? 'Like'}${count == null ? '' : ', $count'}',
        child: InkWell(
          enableFeedback: false,
          borderRadius: BorderRadius.circular(14),
          onTap: enabled ? () => onReact!('like') : null,
          onLongPress: enabled ? () => _choose(context) : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
            child: inline
                ? Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(choice?.emoji ?? '\u{1F44D}'),
                      const SizedBox(width: 4),
                      Text(
                        '${count ?? 0}',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ],
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (busy)
                        const SizedBox(
                          width: 30,
                          height: 30,
                          child: Icon(Icons.hourglass_top_rounded),
                        )
                      else
                        Text(
                          choice?.emoji ?? '\u{1F44D}',
                          style: const TextStyle(fontSize: 28),
                        ),
                      Text(
                        count == null ? '' : '$count',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        choice?.label ?? 'Like',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
    final picker = IconButton(
      enableFeedback: false,
      tooltip: 'Choose reaction',
      visualDensity: VisualDensity.compact,
      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      padding: const EdgeInsets.all(4),
      iconSize: 18,
      onPressed: enabled ? () => _choose(context) : null,
      icon: const Icon(Icons.add_reaction_outlined, color: Color(0xFFD8B4FE)),
    );
    return inline
        ? Row(mainAxisSize: MainAxisSize.min, children: [main, picker])
        : Column(mainAxisSize: MainAxisSize.min, children: [main, picker]);
  }
}
