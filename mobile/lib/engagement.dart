import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const reactionChoices = [
  (type: 'like', label: 'Like', emoji: '\u{1F44D}'),
  (type: 'love', label: 'Love', emoji: '\u2764\uFE0F'),
  (type: 'haha', label: 'Haha', emoji: '\u{1F602}'),
  (type: 'wow', label: 'Wow', emoji: '\u{1F62E}'),
  (type: 'sad', label: 'Sad', emoji: '\u{1F622}'),
  (type: 'angry', label: 'Angry', emoji: '\u{1F620}'),
];

Future<void> playEngagementSound() async {
  try {
    await SystemSound.play(SystemSoundType.click);
  } catch (error) {
    debugPrint('Interaction sound unavailable: $error');
  }
}
