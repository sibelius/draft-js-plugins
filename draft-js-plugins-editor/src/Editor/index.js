/* eslint-disable no-continue,no-restricted-syntax */
import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { EditorState, Editor, DefaultDraftBlockRenderMap } from 'draft-js';
import { Map } from 'immutable';
// eslint-disable-next-line
import proxies from './proxies';
import moveSelectionToEnd from './moveSelectionToEnd';
import resolveDecorators from './resolveDecorators';
import defaultKeyBindings from './defaultKeyBindings';
import defaultKeyCommands from './defaultKeyCommands';
import { usePrevious } from './usePrevious';

const getDecoratorLength = obj => {
  let decorators;

  if (obj.decorators != null) {
    decorators = obj.decorators;
  } else if (obj._decorators != null) {
    decorators = obj._decorators;
  }

  return decorators.size != null ? decorators.size : decorators.length;
};

/**
 * The main editor component
 */
const PluginEditor = props => {
  const resolvePlugins = () => {
    const plugins = props.plugins.slice(0);
    if (props.defaultKeyBindings !== false) {
      plugins.push(defaultKeyBindings);
    }
    if (props.defaultKeyCommands !== false) {
      plugins.push(defaultKeyCommands);
    }

    return plugins;
  };

  const editor = useRef();

  // TODO for Nik: ask ben why this is relevent
  const [state, setState] = useState({});

  const setEditorRef = ref => {
    editor.current = ref;

    console.log('ref: ', ref, editor);

    // TODO - check this
    // proxies.forEach(method => {
    //   this[method] = (...args) => editor.current[method](...args);
    // });
  };

  const getEditorState = () => props.editorState;

  const getPlugins = () => props.plugins.slice(0);
  const getProps = () => ({ ...props });

  // TODO further down in render we use readOnly={this.props.readOnly || this.state.readOnly}. Ask Ben why readOnly is here just from the props? Why would plugins use this instead of just taking it from getProps?
  const getReadOnly = () => props.readOnly;
  const setReadOnly = readOnly => {
    if (readOnly !== state.readOnly) setState({ readOnly });
  };

  const getEditorRef = () => editor;

  // Cycle through the plugins, changing the editor state with what the plugins
  // changed (or didn't)
  const onChange = editorState => {
    let newEditorState = editorState;
    resolvePlugins().forEach(plugin => {
      if (plugin.onChange) {
        newEditorState = plugin.onChange(newEditorState, getPluginMethods());
      }
    });

    if (props.onChange) {
      props.onChange(newEditorState, getPluginMethods());
    }
  };

  const getPluginMethods = () => ({
    getPlugins,
    getProps,
    setEditorState: onChange,
    getEditorState,
    getReadOnly,
    setReadOnly,
    getEditorRef,
  });

  useEffect(() => {
    const plugins = useRef([props, ...resolvePlugins()]);

    plugins.forEach(plugin => {
      if (typeof plugin.initialize !== 'function') return;
      plugin.initialize(getPluginMethods());
    });

    const decorator = resolveDecorators(props, getEditorState, onChange);

    const editorState = EditorState.set(props.editorState, { decorator });
    onChange(moveSelectionToEnd(editorState));

    return () => {
      resolvePlugins().forEach(plugin => {
        if (plugin.willUnmount) {
          plugin.willUnmount({
            getEditorState,
            setEditorState: onChange,
          });
        }
      });
    };
  }, []);

  const currDec = props.editorState.getDecorator();
  const previousDec = usePrevious(currDec);

  useEffect(() => {
    // If there is not current decorator, there's nothing to carry over to the next editor state
    if (!currDec) return;

    // If the current decorator is the same as the new one, don't call onChange to avoid infinite loops
    if (currDec === previousDec) return;

    // If the old and the new decorator are the same, but no the same object, also don't call onChange to avoid infinite loops
    if (
      currDec &&
      previousDec &&
      getDecoratorLength(currDec) === getDecoratorLength(previousDec)
    )
      return;

    const editorState = EditorState.set(props.editorState, {
      decorator: currDec,
    });
    onChange(moveSelectionToEnd(editorState));
  }, [currDec, previousDec]);

  const createEventHooks = (methodName, plugins) => (...args) => {
    const newArgs = [].slice.apply(args);
    newArgs.push(getPluginMethods());

    return plugins.some(
      plugin =>
        typeof plugin[methodName] === 'function' &&
        plugin[methodName](...newArgs) === true
    );
  };

  const createHandleHooks = (methodName, plugins) => (...args) => {
    const newArgs = [].slice.apply(args);
    newArgs.push(getPluginMethods());

    return plugins.some(
      plugin =>
        typeof plugin[methodName] === 'function' &&
        plugin[methodName](...newArgs) === 'handled'
    )
      ? 'handled'
      : 'not-handled';
  };

  const createFnHooks = (methodName, plugins) => (...args) => {
    const newArgs = [].slice.apply(args);

    newArgs.push(getPluginMethods());

    if (methodName === 'blockRendererFn') {
      let block = { props: {} };
      plugins.forEach(plugin => {
        if (typeof plugin[methodName] !== 'function') return;
        const result = plugin[methodName](...newArgs);
        if (result !== undefined && result !== null) {
          const { props: pluginProps, ...pluginRest } = result; // eslint-disable-line no-use-before-define
          const { props: blockProps, ...rest } = block; // eslint-disable-line no-use-before-define
          block = {
            ...rest,
            ...pluginRest,
            props: { ...blockProps, ...pluginProps },
          };
        }
      });

      return block.component ? block : false;
    } else if (methodName === 'blockStyleFn') {
      let styles;
      plugins.forEach(plugin => {
        if (typeof plugin[methodName] !== 'function') return;
        const result = plugin[methodName](...newArgs);
        if (result !== undefined && result !== null) {
          styles = (styles ? `${styles} ` : '') + result;
        }
      });

      return styles || '';
    }

    let result;
    const wasHandled = plugins.some(plugin => {
      if (typeof plugin[methodName] !== 'function') return false;
      result = plugin[methodName](...newArgs);
      return result !== undefined;
    });
    return wasHandled ? result : false;
  };

  const createPluginHooks = () => {
    const pluginHooks = {};
    const eventHookKeys = [];
    const handleHookKeys = [];
    const fnHookKeys = [];
    const plugins = [props, ...resolvePlugins()];

    plugins.forEach(plugin => {
      Object.keys(plugin).forEach(attrName => {
        if (attrName === 'onChange') return;

        // if `attrName` has been added as a hook key already, ignore this one
        if (
          eventHookKeys.indexOf(attrName) !== -1 ||
          fnHookKeys.indexOf(attrName) !== -1
        )
          return;

        const isEventHookKey = attrName.indexOf('on') === 0;
        if (isEventHookKey) {
          eventHookKeys.push(attrName);
          return;
        }

        const isHandleHookKey = attrName.indexOf('handle') === 0;
        if (isHandleHookKey) {
          handleHookKeys.push(attrName);
          return;
        }

        // checks if `attrName` ends with 'Fn'
        const isFnHookKey = attrName.length - 2 === attrName.indexOf('Fn');
        if (isFnHookKey) {
          fnHookKeys.push(attrName);
        }
      });
    });

    eventHookKeys.forEach(attrName => {
      pluginHooks[attrName] = createEventHooks(attrName, plugins);
    });

    handleHookKeys.forEach(attrName => {
      pluginHooks[attrName] = createHandleHooks(attrName, plugins);
    });

    fnHookKeys.forEach(attrName => {
      pluginHooks[attrName] = createFnHooks(attrName, plugins);
    });

    return pluginHooks;
  };

  const resolveCustomStyleMap = () =>
    props.plugins
      .filter(plug => plug.customStyleMap !== undefined)
      .map(plug => plug.customStyleMap)
      .concat([props.customStyleMap])
      .reduce(
        (styles, style) => ({
          ...styles,
          ...style,
        }),
        {}
      );

  const resolveblockRenderMap = () => {
    let blockRenderMap = props.plugins
      .filter(plug => plug.blockRenderMap !== undefined)
      .reduce((maps, plug) => maps.merge(plug.blockRenderMap), Map({}));
    if (props.defaultBlockRenderMap) {
      blockRenderMap = DefaultDraftBlockRenderMap.merge(blockRenderMap);
    }
    if (props.blockRenderMap) {
      blockRenderMap = blockRenderMap.merge(blockRenderMap);
    }
    return blockRenderMap;
  };

  const resolveAccessibilityProps = () => {
    let accessibilityProps = {};
    const plugins = [props, ...resolvePlugins()];
    plugins.forEach(plugin => {
      if (typeof plugin.getAccessibilityProps !== 'function') return;
      const accProps = plugin.getAccessibilityProps();
      const popupProps = {};

      if (accessibilityProps.ariaHasPopup === undefined) {
        popupProps.ariaHasPopup = accProps.ariaHasPopup;
      } else if (accProps.ariaHasPopup === 'true') {
        popupProps.ariaHasPopup = 'true';
      }

      if (accessibilityProps.ariaExpanded === undefined) {
        popupProps.ariaExpanded = accProps.ariaExpanded;
      } else if (accProps.ariaExpanded === true) {
        popupProps.ariaExpanded = true;
      }

      accessibilityProps = {
        ...accessibilityProps,
        ...accProps,
        ...popupProps,
      };
    });

    return accessibilityProps;
  };

  const pluginHooks = createPluginHooks();
  const customStyleMap = resolveCustomStyleMap();
  const accessibilityProps = resolveAccessibilityProps();
  const blockRenderMap = resolveblockRenderMap();

  return (
    <Editor
      {...props}
      {...accessibilityProps}
      {...pluginHooks}
      readOnly={props.readOnly || state.readOnly}
      customStyleMap={customStyleMap}
      blockRenderMap={blockRenderMap}
      onChange={onChange}
      editorState={props.editorState}
      ref={editor}
    />
  );
};

PluginEditor.defaultProps = {
  defaultBlockRenderMap: true,
  defaultKeyBindings: true,
  defaultKeyCommands: true,
  customStyleMap: {},
  plugins: [],
  decorators: [],
};

PluginEditor.propTypes = {
  editorState: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  plugins: PropTypes.array,
  defaultKeyBindings: PropTypes.bool,
  defaultKeyCommands: PropTypes.bool,
  defaultBlockRenderMap: PropTypes.bool,
  customStyleMap: PropTypes.object,
  // eslint-disable-next-line react/no-unused-prop-types
  decorators: PropTypes.array,
};

export default PluginEditor;
