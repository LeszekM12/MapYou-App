import WidgetKit
import SwiftUI
import LiveActivitiesKit

@main
struct LiveActivitiesBundle: WidgetBundle {
    var body: some Widget {
        // `LiveActivities()` — szablonowy widget wygenerowany przez Xcode przy
        // tworzeniu rozszerzenia. Pokazywal „Time / Emoji 😀" i trafial do
        // GALERII WIDZETOW kazdego uzytkownika, ktory pobierze aplikacje.
        //
        // Wylaczony, bo widget z trescia demonstracyjna to funkcja nieukonczona —
        // a takie Apple odrzuca przy recenzji. Sam plik `LiveActivities.swift`
        // zostaje w projekcie jako punkt wyjscia, gdyby kiedys powstal prawdziwy
        // widget z dystansem i tempem.
        //
        // `DynamicActivityWidget()` to ten wlasciwy — obsluguje Live Activity
        // na ekranie blokady podczas treningu i musi zostac.
        DynamicActivityWidget()
    }
}
