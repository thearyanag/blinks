import { createRoot } from 'react-dom/client';
import {
  Action,
  ActionsRegistry,
  getExtendedActionState,
  getExtendedInterstitialState,
  getExtendedWebsiteState,
  type ActionAdapter,
  type ActionCallbacksConfig,
} from '../api';
import { checkSecurity, type SecurityLevel } from '../shared';
import { ActionContainer, type StylePreset } from '../ui';
import { noop } from '../utils/constants';
import { isInterstitial } from '../utils/interstitial-url.ts';
import { proxify } from '../utils/proxify.ts';
import { ActionsURLMapper, type ActionsJsonConfig } from '../utils/url-mapper';

type ObserverSecurityLevel = SecurityLevel;

export interface ObserverOptions {
  // trusted > unknown > malicious
  securityLevel:
    | ObserverSecurityLevel
    | Record<'websites' | 'interstitials' | 'actions', ObserverSecurityLevel>;
}

interface NormalizedObserverOptions {
  securityLevel: Record<
    'websites' | 'interstitials' | 'actions',
    ObserverSecurityLevel
  >;
}

const DEFAULT_OPTIONS: ObserverOptions = {
  securityLevel: 'only-trusted',
};

const normalizeOptions = (
  options: Partial<ObserverOptions>,
): NormalizedObserverOptions => {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    securityLevel: (() => {
      if (!options.securityLevel) {
        return {
          websites: DEFAULT_OPTIONS.securityLevel as ObserverSecurityLevel,
          interstitials: DEFAULT_OPTIONS.securityLevel as ObserverSecurityLevel,
          actions: DEFAULT_OPTIONS.securityLevel as ObserverSecurityLevel,
        };
      }

      if (typeof options.securityLevel === 'string') {
        return {
          websites: options.securityLevel,
          interstitials: options.securityLevel,
          actions: options.securityLevel,
        };
      }

      return options.securityLevel;
    })(),
  };
};

export function setupTwitterObserver(
  config: ActionAdapter,
  callbacks: Partial<ActionCallbacksConfig> = {},
  options: Partial<ObserverOptions> = DEFAULT_OPTIONS,
) {
  const mergedOptions = normalizeOptions(options);
  const twitterReactRoot = document.getElementById('react-root')!;

  const refreshRegistry = async () => {
    return ActionsRegistry.getInstance().init();
  };

  // if we don't have the registry, then we don't show anything
  refreshRegistry().then(() => {
    // entrypoint
    const observer = new MutationObserver((mutations) => {
      // it's fast to iterate like this
      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];
        for (let j = 0; j < mutation.addedNodes.length; j++) {
          const node = mutation.addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
          }
          handleNewNode(
            node as Element,
            config,
            callbacks,
            mergedOptions,
          ).catch(noop);
        }
      }
    });

    observer.observe(twitterReactRoot, { childList: true, subtree: true });
  });
}
async function handleNewNode(
  node: Element,
  config: ActionAdapter,
  callbacks: Partial<ActionCallbacksConfig>,
  options: NormalizedObserverOptions,
) {
  const element = node as Element;
  // first quick filtration
  if (!element || element.localName !== 'div') {
    return;
  }

  let anchor;

  const linkPreview = findLinkPreview(element);
  const likeButton = findBookmarkButton(element);

  if (likeButton) {
    likeButton.append(createDropdown(likeButton));
  }

  let container = findContainerInTweet(
    linkPreview?.card ?? element,
    Boolean(linkPreview),
  );
  if (linkPreview) {
    anchor = linkPreview.anchor;
    container && container.remove();
    container = linkPreview.card.parentElement as HTMLElement;
  } else {
    if (container) {
      return;
    }
    const link = findLastLinkInText(element);
    if (link) {
      anchor = link.anchor;
      container = getContainerForLink(link.tweetText);
    }
  }

  if (!anchor || !container) return;

  const shortenedUrl = anchor.href;
  const actionUrl = await resolveTwitterShortenedUrl(shortenedUrl);
  const interstitialData = isInterstitial(actionUrl);

  let actionApiUrl: string | null;
  if (interstitialData.isInterstitial) {
    const interstitialState = getExtendedInterstitialState(
      actionUrl.toString(),
    );

    if (
      !checkSecurity(interstitialState, options.securityLevel.interstitials)
    ) {
      return;
    }

    actionApiUrl = interstitialData.decodedActionUrl;
  } else {
    const websiteState = getExtendedWebsiteState(actionUrl.toString());

    if (!checkSecurity(websiteState, options.securityLevel.websites)) {
      return;
    }

    const actionsJsonUrl = actionUrl.origin + '/actions.json';
    const actionsJson = await fetch(proxify(actionsJsonUrl)).then(
      (res) => res.json() as Promise<ActionsJsonConfig>,
    );

    const actionsUrlMapper = new ActionsURLMapper(actionsJson);

    actionApiUrl = actionsUrlMapper.mapUrl(actionUrl);
  }

  const state = actionApiUrl ? getExtendedActionState(actionApiUrl) : null;
  if (
    !actionApiUrl ||
    !state ||
    !checkSecurity(state, options.securityLevel.actions)
  ) {
    return;
  }

  const action = await Action.fetch(actionApiUrl, config).catch(noop);

  if (!action) {
    return;
  }

  if (config.isSupported) {
    const supported = await config.isSupported({
      originalUrl: actionUrl.toString(),
      action,
      actionType: state,
    });
    if (!supported) {
      return;
    }
  }

  addMargin(container).replaceChildren(
    createAction({
      originalUrl: actionUrl,
      action,
      callbacks,
      options,
      isInterstitial: interstitialData.isInterstitial,
    }),
  );
}

function createDropdown(likeButton: HTMLElement) {
  const dropdownContainer = document.createElement('div');
  dropdownContainer.className = 'dialect-dropdown-container';
  dropdownContainer.style.display = 'inline-flex';
  dropdownContainer.style.alignItems = 'center';
  dropdownContainer.style.marginLeft = '8px';
  dropdownContainer.style.position = 'relative';

  // Create SVG icon
  const svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgIcon.setAttribute('viewBox', '0 0 24 24');
  svgIcon.setAttribute('width', '18');
  svgIcon.setAttribute('height', '18');
  svgIcon.style.fill = 'currentColor';
  svgIcon.innerHTML = `
    <path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
  `;

  // Create custom dropdown
  const customDropdown = document.createElement('div');
  customDropdown.className = 'dialect-custom-dropdown';
  customDropdown.style.display = 'inline-flex';
  customDropdown.style.alignItems = 'center';
  customDropdown.style.cursor = 'pointer';
  customDropdown.style.padding = '6px';
  customDropdown.style.borderRadius = '50%';
  customDropdown.style.transition = 'background-color 0.2s';

  customDropdown.appendChild(svgIcon);

  // Create options container
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'dialect-options-container';
  optionsContainer.style.display = 'none';
  optionsContainer.style.position = 'absolute';
  optionsContainer.style.bottom = '100%';
  optionsContainer.style.right = '0';
  optionsContainer.style.backgroundColor = 'blue';
  optionsContainer.style.border = '1px solid #ccc';
  optionsContainer.style.borderRadius = '4px';
  optionsContainer.style.boxShadow = '0 -2px 10px rgba(0,0,0,0.1)';
  optionsContainer.style.zIndex = '1000';
  optionsContainer.style.marginBottom = '10px';
  optionsContainer.style.minWidth = '200px';
  optionsContainer.style.maxHeight = '300px';
  optionsContainer.style.overflowY = 'auto';
  optionsContainer.style.overflowX = 'hidden';

  // Prevent scroll propagation
  optionsContainer.addEventListener(
    'wheel',
    (event) => {
      event.stopPropagation();
      const { scrollTop, scrollHeight, clientHeight } = optionsContainer;
      if (
        (scrollTop === 0 && event.deltaY < 0) ||
        (scrollTop + clientHeight === scrollHeight && event.deltaY > 0)
      ) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  // Handle touch scrolling
  let touchStartY = 0;
  optionsContainer.addEventListener(
    'touchstart',
    (event) => {
      touchStartY = event.touches[0].clientY;
    },
    { passive: true },
  );

  optionsContainer.addEventListener(
    'touchmove',
    (event) => {
      if (!touchStartY) {
        return;
      }
      const touchY = event.touches[0].clientY;
      const { scrollTop, scrollHeight, clientHeight } = optionsContainer;
      if (
        (scrollTop === 0 && touchY > touchStartY) ||
        (scrollTop + clientHeight === scrollHeight && touchY < touchStartY)
      ) {
        event.preventDefault();
      }
      event.stopPropagation();
    },
    { passive: false },
  );

  // Add detailed options
  const options = [
    {
      name: 'Access Protocol',
      description: 'gate your content',
      verified: 'Yes',
      act: 'access-protocol.dial.to',
    },
    {
      name: 'Arkenstone Suite',
      description: 'developing a token presale Suite',
      verified: 'No',
      act: 'arkenstone.gold',
    },
    {
      name: 'Blinks',
      description: 'Blinks Inspector',
      verified: 'Yes',
      act: 'blinks.gg',
    },
    {
      name: 'Sol Casino',
      description: 'Roulette on Solana',
      verified: 'Yes',
      act: 'solcasino.io',
    },
  ];

  options.forEach((optionData) => {
    const option = document.createElement('div');
    option.style.padding = '12px';
    option.style.borderBottom = '1px solid #eee';
    option.style.cursor = 'pointer';
    option.style.transition = 'background-color 0.2s';

    const content = `
      <div style="font-weight: bold;">Name: ${optionData.name}</div>
      <div>Description: ${optionData.description}</div>
      <div>Verified: ${optionData.verified}</div>
      <div>Act: ${optionData.act}</div>
    `;
    option.innerHTML = content;

    option.addEventListener('mouseenter', () => {
      option.style.backgroundColor = '#f0f0f0';
    });

    option.addEventListener('mouseleave', () => {
      option.style.backgroundColor = 'transparent';
    });

    option.addEventListener('click', (event) => {
      event.stopPropagation();
      console.log('Selected option:', optionData);
      optionsContainer.style.display = 'none';
    });

    optionsContainer.appendChild(option);
  });

  customDropdown.appendChild(optionsContainer);

  // Event listeners (same as before)
  customDropdown.addEventListener('click', (event) => {
    event.stopPropagation();
    optionsContainer.style.display =
      optionsContainer.style.display === 'none' ? 'block' : 'none';
  });

  customDropdown.addEventListener('mouseenter', () => {
    customDropdown.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
  });

  customDropdown.addEventListener('mouseleave', () => {
    customDropdown.style.backgroundColor = 'transparent';
  });

  document.addEventListener('click', () => {
    optionsContainer.style.display = 'none';
  });

  dropdownContainer.appendChild(customDropdown);

  // Insert the dropdown container after the like button
  likeButton.parentNode?.insertBefore(
    dropdownContainer,
    likeButton.nextSibling,
  );

  return dropdownContainer;
}

function createAction({
  originalUrl,
  action,
  callbacks,
  options,
}: {
  originalUrl: URL;
  action: Action;
  callbacks: Partial<ActionCallbacksConfig>;
  options: NormalizedObserverOptions;
  isInterstitial: boolean;
}) {
  const container = document.createElement('div');
  container.className = 'dialect-action-root-container';

  const actionRoot = createRoot(container);

  actionRoot.render(
    <div onClick={(e) => e.stopPropagation()}>
      <ActionContainer
        stylePreset={resolveXStylePreset()}
        action={action}
        websiteUrl={originalUrl.toString()}
        websiteText={originalUrl.hostname}
        callbacks={callbacks}
        securityLevel={options.securityLevel}
      />
    </div>,
  );

  return container;
}

const resolveXStylePreset = (): StylePreset => {
  const colorScheme = document.querySelector('html')?.style.colorScheme;

  if (colorScheme) {
    return colorScheme === 'dark' ? 'x-dark' : 'x-light';
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'x-dark' : 'x-light';
};

async function resolveTwitterShortenedUrl(shortenedUrl: string): Promise<URL> {
  const res = await fetch(shortenedUrl);
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const actionUrl = doc.querySelector('title')?.textContent;
  return new URL(actionUrl!);
}

function findElementByTestId(element: Element, testId: string) {
  if (element.attributes.getNamedItem('data-testid')?.value === testId) {
    return element;
  }
  return element.querySelector(`[data-testid="${testId}"]`);
}

function findContainerInTweet(element: Element, searchUp?: boolean) {
  const message = searchUp
    ? (element.closest(`[data-testid="tweet"]`) ??
      element.closest(`[data-testid="messageEntry"]`))
    : (findElementByTestId(element, 'tweet') ??
      findElementByTestId(element, 'messageEntry'));

  if (message) {
    return message.querySelector('.dialect-wrapper') as HTMLElement;
  }
  return null;
}

function findLinkPreview(element: Element) {
  const card = findElementByTestId(element, 'card.wrapper');
  if (!card) {
    return null;
  }

  const anchor = card.children[0]?.children[0] as HTMLAnchorElement;

  return anchor ? { anchor, card } : null;
}
function findLastLinkInText(element: Element) {
  const tweetText = findElementByTestId(element, 'tweetText');
  if (!tweetText) {
    return null;
  }

  const links = tweetText.getElementsByTagName('a');
  if (links.length > 0) {
    const anchor = links[links.length - 1] as HTMLAnchorElement;
    return { anchor, tweetText };
  }
  return null;
}

function findBookmarkButton(element: Element) {
  // First, try to find the tweet container
  const tweet = element.closest('[data-testid="tweet"]');
  if (!tweet) return null;

  const likeButton = tweet.querySelector('[data-testid="bookmark"]');
  if (!likeButton) return null;

  const likeButtonParent = likeButton.parentElement;
  if (!likeButtonParent) return null;

  if (likeButtonParent.hasAttribute('data-dialect-processed')) {
    return null; // We've already processed this button, so return null
  }

  likeButtonParent.setAttribute('data-dialect-processed', 'true');

  return likeButtonParent as HTMLElement;
}

function getContainerForLink(tweetText: Element) {
  const root = document.createElement('div');
  root.className = 'dialect-wrapper';
  const dm = tweetText.closest(`[data-testid="messageEntry"]`);
  if (dm) {
    root.classList.add('dialect-dm');
    tweetText.parentElement?.parentElement?.prepend(root);
  } else {
    tweetText.parentElement?.append(root);
  }
  return root;
}

function addMargin(element: HTMLElement) {
  if (element && element.classList.contains('dialect-wrapper')) {
    element.style.marginTop = '12px';
    if (element.classList.contains('dialect-dm')) {
      element.style.marginBottom = '8px';
    }
  }
  return element;
}
