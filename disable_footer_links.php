<?php
/**
 * Скрипт для отключения кликабельности ссылок в футере
 */

$htmlFile = 'Meta Pay _ Meta.html';

if (!file_exists($htmlFile)) {
    die("Файл $htmlFile не найден!\n");
}

// Читаем HTML файл
$html = file_get_contents($htmlFile);

// Добавляем CSS стили для отключения кликабельности футера
// Ищем все ссылки в футере и добавляем стили для их отключения
$footerDisableCSS = '
<style id="footer-disable-styles">
/* Отключаем кликабельность всех ссылок в футере */
body a[href*="facebook.com"],
body a[href*="meta.com"],
body a[href*="instagram.com"],
body a[href*="whatsapp.com"],
body a[href*="messenger.com"],
body a[href*="workplace.com"],
body a[href*="pay.facebook.com"],
body a[href*="help"],
body a[href*="privacy"],
body a[href*="terms"],
body a[href*="cookie"],
body a[href*="policy"],
body a[href*="about"],
body a[href*="careers"],
body a[href*="newsroom"],
body a[href*="legal"],
body a[href*="retailers"],
body a[href*="demo"],
body a[href*="returns"],
body a[href*="order"],
body a[href*="verified"],
body a[href*="community"],
body a[href*="standards"],
body a[href*="creators"],
body a[href*="developers"],
body a[href*="businesses"],
body a[href*="non-profits"],
body a[href*="sdk"],
body a[href*="partner"],
body a[href*="vr"],
body a[href*="data"],
body a[href*="elections"],
body a[href*="investors"],
body a[href*="brand"],
body a[href*="media"],
body a[href*="safety"],
body a[href*="quest"],
body a[href*="ray-ban"],
body a[href*="accessories"],
body a[href*="apps"],
body a[href*="games"],
body a[href*="gift"],
body a[href*="refurbished"],
body a[href*="warranty"],
body a[href*="work"],
body a[href*="education"],
body a[href*="referrals"],
body a[href*="discount"],
body a[href*="blog"] {
    pointer-events: none !important;
    cursor: default !important;
    text-decoration: none !important;
}

/* Альтернативный способ - отключить все ссылки в нижней части страницы */
body > div:last-child a,
footer a,
[class*="footer"] a,
[class*="Footer"] a {
    pointer-events: none !important;
    cursor: default !important;
}
</style>
';

// Добавляем JavaScript для дополнительной защиты от кликов
$footerDisableJS = '
<script>
(function() {
    // Отключаем все клики по ссылкам в футере
    document.addEventListener("DOMContentLoaded", function() {
        // Находим все ссылки, которые могут быть в футере
        var links = document.querySelectorAll("a[href*=\'facebook.com\'], a[href*=\'meta.com\'], a[href*=\'instagram.com\'], a[href*=\'whatsapp.com\'], a[href*=\'help\'], a[href*=\'privacy\'], a[href*=\'terms\'], a[href*=\'cookie\'], a[href*=\'policy\']");
        
        links.forEach(function(link) {
            // Проверяем, находится ли ссылка в нижней части страницы (футер)
            var rect = link.getBoundingClientRect();
            var windowHeight = window.innerHeight || document.documentElement.clientHeight;
            
            // Если ссылка в нижней трети страницы, отключаем её
            if (rect.top > windowHeight * 0.6) {
                link.style.pointerEvents = "none";
                link.style.cursor = "default";
                link.addEventListener("click", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                });
            }
        });
        
        // Также отключаем все ссылки в элементах, которые находятся в конце body
        var bodyChildren = document.body.children;
        if (bodyChildren.length > 0) {
            var lastElements = Array.from(bodyChildren).slice(-3); // Последние 3 элемента
            lastElements.forEach(function(element) {
                var footerLinks = element.querySelectorAll("a");
                footerLinks.forEach(function(link) {
                    link.style.pointerEvents = "none";
                    link.style.cursor = "default";
                    link.addEventListener("click", function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    });
                });
            });
        }
    });
})();
</script>
';

// Вставляем CSS перед закрывающим тегом </head>
if (strpos($html, '</head>') !== false) {
    $html = str_replace('</head>', $footerDisableCSS . '</head>', $html);
} else {
    // Если нет </head>, вставляем в начало <body>
    if (strpos($html, '<body') !== false) {
        $html = preg_replace('/(<body[^>]*>)/', '$1' . $footerDisableCSS, $html);
    }
}

// Вставляем JavaScript перед закрывающим тегом </body>
if (strpos($html, '</body>') !== false) {
    $html = str_replace('</body>', $footerDisableJS . '</body>', $html);
} else {
    // Если нет </body>, добавляем в конец
    $html .= $footerDisableJS;
}

// Сохраняем измененный файл
file_put_contents($htmlFile, $html);

echo "Готово! Футер сделан некликабельным.\n";
echo "Файл $htmlFile обновлен.\n";
?>

