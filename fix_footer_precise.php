<?php
/**
 * Точное исправление - отключает ТОЛЬКО футер, не трогая остальные элементы
 */

$htmlFile = 'Meta Pay _ Meta.html';

if (!file_exists($htmlFile)) {
    die("Файл $htmlFile не найден!\n");
}

// Читаем HTML файл
$html = file_get_contents($htmlFile);

// Удаляем ВСЕ старые стили и скрипты, связанные с блокировкой ссылок
$html = preg_replace('/<style[^>]*id=["\']footer-disable[^"\']*["\'][^>]*>.*?<\/style>/s', '', $html);
$html = preg_replace('/<style[^>]*>[\s\S]*?Отключаем кликабельность[\s\S]*?<\/style>/s', '', $html);
$html = preg_replace('/<script[^>]*>[\s\S]*?Отключаем все клики по ссылкам[\s\S]*?<\/script>/s', '', $html);
$html = preg_replace('/<script[^>]*>[\s\S]*?disableFooterLinks[\s\S]*?<\/script>/s', '', $html);

// Простое и точное решение - только CSS для элементов в самом низу страницы
// Используем очень специфичный селектор, который не затронет основные кнопки
$footerDisableCSS = '
<style id="footer-disable-precise">
/* Отключаем ТОЛЬКО ссылки в футере - используем очень специфичные селекторы */
/* Эти селекторы применяются только к элементам в самом низу body */
body > div:last-of-type a[href*="facebook.com/help"],
body > div:last-of-type a[href*="meta.com"],
body > div:last-of-type a[href*="instagram.com/help"],
body > div:last-of-type a[href*="whatsapp.com/help"],
body > div:last-of-type a[href*="privacy"],
body > div:last-of-type a[href*="terms"],
body > div:last-of-type a[href*="cookie"],
body > div:last-of-type a[href*="policy"],
body > div:last-of-type a[href*="legal"],
body > div:last-of-type a[href*="careers"],
body > div:last-of-type a[href*="newsroom"],
body > div:last-of-type a[href*="about"],
body > div:last-of-type a[href*="community"],
body > div:last-of-type a[href*="standards"],
footer a,
[role="contentinfo"] a {
    pointer-events: none !important;
    cursor: default !important;
}
</style>
';

// JavaScript - очень точный, только для реального футера
$footerDisableJS = '
<script>
(function() {
    function disableOnlyFooter() {
        // Находим все ссылки
        var allLinks = document.querySelectorAll("a[href]");
        var documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        
        // Ключевые слова, которые точно указывают на футер
        var footerKeywords = [
            "Privacy Policy", "Terms of Service", "Cookie Policy", "Legal",
            "Community Standards", "About Meta", "Careers", "Newsroom",
            "Facebook Help Center", "Instagram Help Center", "WhatsApp Help Center",
            "Meta Store", "Meta Quest", "Ray-Ban", "Accessories", "Apps and games"
        ];
        
        allLinks.forEach(function(link) {
            var linkText = (link.textContent || "").trim();
            var href = (link.href || link.getAttribute("href") || "").toLowerCase();
            var rect = link.getBoundingClientRect();
            var linkTop = rect.top + window.scrollY;
            
            // Проверяем, что это ссылка футера по тексту или URL
            var isFooterLink = footerKeywords.some(function(keyword) {
                return linkText.includes(keyword) || 
                       href.includes(keyword.toLowerCase().replace(/\s+/g, ""));
            });
            
            // Проверяем позицию - должна быть в нижних 15% страницы
            var isInBottom = linkTop > documentHeight * 0.85;
            
            // Отключаем ТОЛЬКО если это точно ссылка футера И внизу страницы
            if (isFooterLink && isInBottom) {
                link.style.pointerEvents = "none";
                link.style.cursor = "default";
                link.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                };
            }
        });
    }
    
    // Запускаем после загрузки
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", disableOnlyFooter);
    } else {
        disableOnlyFooter();
    }
    
    window.addEventListener("load", function() {
        setTimeout(disableOnlyFooter, 1000);
    });
})();
</script>
';

// Вставляем CSS перед закрывающим тегом </head>
if (strpos($html, '</head>') !== false) {
    $html = str_replace('</head>', $footerDisableCSS . '</head>', $html);
} else {
    if (preg_match('/<body[^>]*>/', $html)) {
        $html = preg_replace('/(<body[^>]*>)/', '$1' . $footerDisableCSS, $html);
    }
}

// Вставляем JavaScript перед закрывающим тегом </body>
if (strpos($html, '</body>') !== false) {
    $html = str_replace('</body>', $footerDisableJS . '</body>', $html);
} else {
    $html .= $footerDisableJS;
}

// Сохраняем
file_put_contents($htmlFile, $html);

echo "Исправлено! Теперь блокируется ТОЛЬКО футер, все остальные кнопки работают.\n";
echo "Файл $htmlFile обновлен.\n";
?>

