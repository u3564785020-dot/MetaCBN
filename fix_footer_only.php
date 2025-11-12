<?php
/**
 * Скрипт для отключения кликабельности ТОЛЬКО в футере
 * Исправляет предыдущую версию, которая блокировала все ссылки
 */

$htmlFile = 'Meta Pay _ Meta.html';

if (!file_exists($htmlFile)) {
    die("Файл $htmlFile не найден!\n");
}

// Читаем HTML файл
$html = file_get_contents($htmlFile);

// Удаляем старые стили и скрипты, которые блокировали все ссылки
$html = preg_replace('/<style id="footer-disable-styles">.*?<\/style>/s', '', $html);
$html = preg_replace('/<script>[\s\S]*?Отключаем все клики по ссылкам в футере[\s\S]*?<\/script>/', '', $html);

// Новый CSS - только для футера (элементы в нижней части страницы)
$footerDisableCSS = '
<style id="footer-disable-only">
/* Отключаем кликабельность ТОЛЬКО ссылок в футере */
/* Используем селектор для элементов внизу страницы */
body > div:last-child a,
footer a,
[class*="footer"] a,
[class*="Footer"] a,
[class*="FOOTER"] a {
    pointer-events: none !important;
    cursor: default !important;
    text-decoration: none !important;
}

/* Более точный селектор - только ссылки в последних элементах body */
body > *:last-child a,
body > *:nth-last-child(2) a,
body > *:nth-last-child(3) a {
    pointer-events: none !important;
    cursor: default !important;
}
</style>
';

// JavaScript для точного определения футера
$footerDisableJS = '
<script>
(function() {
    function disableFooterLinks() {
        // Находим все ссылки на странице
        var allLinks = document.querySelectorAll("a[href]");
        var windowHeight = window.innerHeight || document.documentElement.clientHeight;
        var documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        
        allLinks.forEach(function(link) {
            var rect = link.getBoundingClientRect();
            var linkTop = rect.top + window.scrollY;
            
            // Определяем, находится ли ссылка в нижней части страницы (последние 20% страницы)
            // Это и будет футер
            var footerThreshold = documentHeight * 0.8; // Нижние 20% страницы
            
            // Также проверяем, что ссылка видна в нижней части viewport
            var isInFooter = linkTop > footerThreshold || 
                            (rect.top > windowHeight * 0.7 && rect.bottom > windowHeight * 0.6);
            
            // Проверяем, что это действительно ссылка футера (содержит типичные слова футера)
            var href = link.href || link.getAttribute("href") || "";
            var linkText = (link.textContent || "").toLowerCase();
            
            var footerKeywords = [
                "privacy", "terms", "cookie", "policy", "legal", "about", 
                "careers", "help", "support", "community", "standards",
                "creators", "developers", "businesses", "non-profits",
                "facebook.com/help", "meta.com/help", "instagram.com/help",
                "whatsapp.com/help", "messenger.com/help", "workplace.com/help"
            ];
            
            var isFooterLink = footerKeywords.some(function(keyword) {
                return href.toLowerCase().includes(keyword) || 
                       linkText.includes(keyword);
            });
            
            // Отключаем только если это ссылка в футере И содержит ключевые слова футера
            if (isInFooter && isFooterLink) {
                link.style.pointerEvents = "none";
                link.style.cursor = "default";
                link.addEventListener("click", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }, true);
            }
        });
    }
    
    // Запускаем после загрузки DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", disableFooterLinks);
    } else {
        disableFooterLinks();
    }
    
    // Также запускаем после полной загрузки страницы
    window.addEventListener("load", function() {
        setTimeout(disableFooterLinks, 500);
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

echo "Исправлено! Теперь некликабельным будет ТОЛЬКО футер.\n";
echo "Файл $htmlFile обновлен.\n";
?>

