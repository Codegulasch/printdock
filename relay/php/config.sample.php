<?php
// Kopieren nach config.php und Schlüssel eintragen (lang und zufällig, z. B. 48 Zeichen).
// Je PrintDock-Installation ein Eintrag: 'Name' => 'Schlüssel'. Den Schlüssel in PrintDock unter
// Einstellungen → Fernzugriff → Kunden-Links eintragen.
return [
    'keys' => [
        'werkstatt' => 'HIER-EINEN-LANGEN-ZUFAELLIGEN-SCHLUESSEL-EINTRAGEN',
    ],
    // Ablage für Statusseiten und Fotos – am besten außerhalb des Web-Ordners, sonst schützt data/.htaccess
    'data' => __DIR__ . '/data',
];
