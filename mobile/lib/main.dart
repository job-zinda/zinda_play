import 'package:flutter/material.dart';

import 'api.dart';
import 'screens/home_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.instance.restore();
  runApp(const ZindaApp());
}

class ZindaApp extends StatelessWidget {
  const ZindaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Zinda Play',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5CF6),
          brightness: Brightness.dark,
          primary: const Color(0xFFA78BFA),
          surface: const Color(0xFF090A10),
        ),
        scaffoldBackgroundColor: const Color(0xFF08090E),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF090A10),
          surfaceTintColor: Colors.transparent,
          scrolledUnderElevation: 0,
          elevation: 0,
          shape: Border(bottom: BorderSide(color: Color(0x0DFFFFFF))),
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: const Color(0xFF090A10),
          surfaceTintColor: Colors.transparent,
          indicatorColor: const Color(0x338B5CF6),
          iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(
              color: s.contains(WidgetState.selected) ? const Color(0xFFD6C8FF) : const Color(0xFFA7A6B7))),
          labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
              fontSize: 12,
              color: s.contains(WidgetState.selected) ? const Color(0xFFD6C8FF) : const Color(0xFFA7A6B7))),
        ),
        cardColor: const Color(0xFF11121B),
        dividerColor: const Color(0xFF242532),
      ),
      home: const HomeScreen(),
    );
  }
}
