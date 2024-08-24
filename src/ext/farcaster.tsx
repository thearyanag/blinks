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

export function setupFarcasterObserver(
  config: ActionAdapter,
  callbacks: Partial<ActionCallbacksConfig> = {},
  options: Partial<ObserverOptions> = DEFAULT_OPTIONS,
) {
  const mergedOptions = normalizeOptions(options);
  const farcasterRoot = document.getElementById('root')!;

  if (!farcasterRoot) {
    console.log('Farcaster root not found');
    return;
  } else {
    console.log('Farcaster root found');
  }

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
            // continue;
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

    observer.observe(farcasterRoot, { childList: true, subtree: true });
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

  // farcaster element has 2 types
  // 1. div(.' fade-in') = when the page loads, an initial set of casts are loaded
  // 2. div(.relative) under another div = when a new cast is loaded when scrolling

  // so we need to check if the element is either of the above
  if (
    !element.className.includes(' fade-in') &&
    !element.className.includes('relative')
  ) {
    return;
  }

  // does not work with space
  // console.log("element.classList.contains(' fade-in')", element.classList.contains(' fade-in'));

  console.log('handleNewNode', element);

  let anchor;

  const linkPreview = findLinkPreview(element);

  let container = findContainerInCast(
    linkPreview?.card ?? element,
    Boolean(linkPreview),
  );
  if (linkPreview) {
    anchor = linkPreview.anchor;
    container && container.remove();
    container = linkPreview.card.parentElement as HTMLElement;
  } else {
    container = getContainerForLink(element);
  }

  // need the anchor and container

  if (!anchor || !container) return;

  // as fc does not shortens the URL like twitter
  const actionUrl = new URL(anchor.href);
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

// async function resolveTwitterShortenedUrl(shortenedUrl: string): Promise<URL> {
//   const res = await fetch(shortenedUrl);
//   const html = await res.text();
//   const parser = new DOMParser();
//   const doc = parser.parseFromString(html, 'text/html');
//   const actionUrl = doc.querySelector('title')?.textContent;
//   return new URL(actionUrl!);
// }

function findElementByTestId(element: Element, testId: string) {
  if (element.attributes.getNamedItem('data-testid')?.value === testId) {
    return element;
  }
  return element.querySelector(`[data-testid="${testId}"]`);
}

function findContainerInCast(element: Element, searchUp?: boolean) {
  const message = searchUp
    ? (element.closest(`a`) ?? element.closest(`[data-testid="messageEntry"]`))
    : (findElementByTestId(element, 'tweet') ??
      findElementByTestId(element, 'messageEntry'));

  if (message) {
    return message.querySelector('.dialect-wrapper') as HTMLElement;
  }
  return null;
}

// it will iterate through the children of the card and find the anchor tag
function findLinkPreview(element: Element) {
  // const card = findElementByTestId(element, 'card.wrapper');
  // if (!card) {
  //   return null;
  // }

  // const anchor = card.children[0]?.children[0] as HTMLAnchorElement;

  const card = element;

  const anchor = card.querySelector('a') as HTMLAnchorElement;

  return anchor ? { anchor, card } : null;
}

function getContainerForLink(castText: Element) {
  const root = document.createElement('div');
  root.className = 'dialect-wrapper';
  const dm = castText.closest(`[class="relative"]`);
  if (dm) {
    root.classList.add('dialect-dm');
    castText.parentElement?.parentElement?.prepend(root);
  } else {
    castText.parentElement?.append(root);
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
